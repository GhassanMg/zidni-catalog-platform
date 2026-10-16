/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testRegex: '(src|test)/.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
};
