// This module will be copied into node_modules during the build. This
// path is relative to the installed location
const mod = require('../../dist/language-server-plugin.js');

module.exports = Object.assign(mod.default, mod);
