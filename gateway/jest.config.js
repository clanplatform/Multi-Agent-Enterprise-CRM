module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/tests/**/*.test.ts', '**/tests/**/*.ts'],
  maxWorkers: 1,
  forceExit: true,
};

