/**
 * @file Naïve userland JS implementation of HTML specifier restriction and
 *     web browser “window” as “globalThis”.
 * @flag --experimental-loader ./index.mjs
 * @license 0BSD
 * @author Derek Lewis <DerekNonGeneric@inf.is>
 * @module {Es6Module} web-context-js/index
 */

// -----------------------------------------------------------------------------
// Requirements
// -----------------------------------------------------------------------------

import { EOL as newlineMarker } from 'os';
import { writeSync } from 'fs';
import clc from 'cli-color';
import columnify from 'columnify';
import supportsAnsi from 'supports-ansi';

// JSDoc comments on the enum values are optional, but if left unspecified, they
// will be interpreted as being of type `number` (i.e., `1`, `1.0`, `-5`, `1e5`,
// `Math.PI`), which is why we've specified.
// @see https://github.com/google/closure-compiler/wiki/Types-in-the-Closure-Type-System#types-in-javascript
// @see https://github.com/google/closure-compiler/wiki/Annotating-JavaScript-for-the-Closure-Compiler#enum-type

/** @enum {string} */
const UnicodeEscapes = {
  leftDoubleQuotes: '\u201c', // “
  rightDoubleQuotes: '\u201d', // ”
  errorSymbol: '\u24E7', // ⓧ
  warningSymbol: '\u26A0', // ⚠
};

// Get the document's base URL since there might not be a referencing script.
const baseURL = new URL('file://');
baseURL.pathname = `${process.cwd()}/`;

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

// TODO: Only use `UnicodeEscapes.errorSymbol` if the terminal supports Unicode
//       and the font used by the terminal has a glyph for it.
process.on('uncaughtException', (err /* , origin */) => {
  const errorText = `Uncaught ${
    err instanceof TypeError ? 'TypeError' : 'Error'
  }: ${err.message}`;

  const columns = columnify(
    [
      {
        symbol: redden(UnicodeEscapes.errorSymbol),
        description: redden(errorText),
      },
    ],
    {
      showHeaders: false,
      minWidth: 3,
      config: {
        symbol: { align: 'center' },
        description: { maxWidth: 76 },
      },
    }
  );

  writeSync(process.stderr.fd, `${columns}${newlineMarker}`);
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Returns true if specifier does not start with the character
 * U+002F SOLIDUS (`/`), the two-character sequence U+002E FULL STOP,
 * U+002F SOLIDUS (`./`), or the three-character sequence U+002E FULL STOP,
 * U+002E FULL STOP, U+002F SOLIDUS (`../`). Bare specifiers are reserved.
 *
 * @param {string} specifier
 * @returns {boolean}
 * @see https://html.spec.whatwg.org/multipage/webappapis.html#resolve-a-module-specifier
 */
export function isReservedSpecifier(specifier) {
  if (!/^\.{0,2}\//.test(specifier) && !specifier.startsWith('file://')) {
    return true;
  }
  return false;
}

/**
 * Returns the supplied string as a curly quoted string.
 * TODO: Only curly quote if the terminal supports Unicode.
 * @param {string} arbitraryString
 * @returns {string}
 */
export function curlyQuote(arbitraryString) {
  // TODO: Get rid of these backslashes.
  return `\
${UnicodeEscapes.leftDoubleQuotes}\
${arbitraryString}\
${UnicodeEscapes.rightDoubleQuotes}\
`;
}

/**
 * Returns the supplied string as italicized if stream supports ANSI escapes.
 * @param {string} arbitraryString
 * @returns {string}
 */
export function italicize(arbitraryString) {
  return supportsAnsi ? clc.italic(arbitraryString) : arbitraryString;
}

/**
 * Returns the supplied string as red colored if stream supports ANSI escapes.
 * @param {string} arbitraryString
 * @returns {string}
 */
export function redden(arbitraryString) {
  return supportsAnsi ? clc.red(arbitraryString) : arbitraryString;
}

/**
 * Returns the supplied string as underlined if stream supports ANSI escapes.
 * @param {string} arbitraryString
 * @returns {string}
 */
export function underline(arbitraryString) {
  return supportsAnsi ? clc.underline(arbitraryString) : arbitraryString;
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 **ERR_INVALID_MODULE_SPECIFIER
 * @description An invalid module specifier error.
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=1566307
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=1645364
 */
export class InvalidModuleSpecifierError extends TypeError {
  /**
   * @param {string} specifier The invalid module specifier.
   * @param {string} referrerUrl The absolute file URL string of the module
   *     making the request.
   */
  constructor(specifier, referrerUrl) {
    super(
      `Failed to resolve module specifier ${curlyQuote(specifier)} imported ` +
        `from ${underline(referrerUrl)}. Bare specifiers are reserved for ` +
        `potential future use and relative references ${italicize('must')} ` +
        `begin with either ${curlyQuote('/')}, ${curlyQuote('./')}, or ` +
        `${curlyQuote('../')}.`
    );
    this.code = 'ERR_INVALID_MODULE_SPECIFIER';
  }
}

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/**
 * Node.js custom loader resolve hook — allows customizing default Node.js
 * module specifier resolution behavior.
 *
 * @param {string} specifier
 * @param {{
 *   parentURL: !(string | undefined),
 *   conditions: !Array<string>,
 * }} context
 * @param {!Function} defaultResolve
 * @returns {Promise<{ url: string }>} The response.
 */
export async function resolve(specifier, context, defaultResolve) {
  const { parentURL = baseURL.href } = context;

  if (isReservedSpecifier(specifier)) {
    throw new InvalidModuleSpecifierError(specifier, parentURL);
  }

  return defaultResolve(specifier, { parentURL }, defaultResolve);
}

/**
 * Node.js custom loader getGlobalPreloadCode hook — allows returning JS source
 * text that will be run as a sloppy-mode script on startup.
 *
 * TODO: Make sure that copying `dom.window` props onto `globalThis` isn't an
 *       antipattern in this context (Node.js ESM).
 * @see https://github.com/jsdom/jsdom/wiki/Don't-stuff-jsdom-globals-onto-the-Node-global
 *
 * @returns {string} Code to run before application startup.
 */
export function getGlobalPreloadCode() {
  // All the ECMAScript code loaded within the scope of the global environment.
  // TODO: Determine name of the context below (`getBuiltin` available global).
  return `\
const { createRequire } = getBuiltin('module');
const require = createRequire(process.cwd() + '/<preload>');

const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const dom = new JSDOM(\`<!DOCTYPE HTML>
<html lang="en">

<head>
  <meta charset="utf-8">
  <title>web-context-js</title>
</head>

<body>
  <p>Hello.</p>
</body>

</html>\`);

Object.defineProperties(
  globalThis,
  Object.getOwnPropertyDescriptors(dom.window)
);
`;
}
