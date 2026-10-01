const assert = require('node:assert/strict');
const pkg = require('../package.json');

assert.equal(pkg.publisher, 'gurtejbirsingh-dev', 'Package publisher must match the Marketplace publisher identity.');
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Package version must be semver patch format.');
console.log('Package metadata checks pass.');
