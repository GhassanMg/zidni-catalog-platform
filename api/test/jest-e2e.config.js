/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@zidni/mcp-server$': '<rootDir>/../mcp-server/src/lib.ts',
  },
  setupFiles: ['<rootDir>/test/support/setup-env.ts'],
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  testTimeout: 30_000,
};
