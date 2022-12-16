import { FileTree, fixtureDocument } from '../fixture-utils';

export const exampleFixtureFiles: FileTree = {
  'README.md': fixtureDocument`
    # I am an example readme

    This message will be written on disk during tests.
  `,
};
