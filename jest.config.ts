import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.constants.ts',
    '!src/entities/**',
    // Ignore types
    '!src/types/**',
    '!src/**/*.types.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: './coverage',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@factories/(.*)$': '<rootDir>/test/factories/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
    'package.json': '<rootDir>/package.json',
  },
};

export default config;
