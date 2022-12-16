#!/usr/bin/env node
const path = require('path');
const { createVSIX } = require('vsce');

function bundle() {
  return createVSIX({
    packagePath: path.join(__dirname, '../demo-extension.vsix'),
    useYarn: true,
  });
}

bundle().catch(err => {
  console.log(err);
  process.exit(1);
});
