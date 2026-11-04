// Buffer write-backs, exactly as plan 1.2 and section 9 have them.

const MUTATION_ERROR = `... on MutationError { message }`;

export const CREATE_POST = /* GraphQL */ `
  mutation CameInCreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status } }
      ${MUTATION_ERROR}
    }
  }
`;

export const CREATE_NOTE = /* GraphQL */ `
  mutation CameInCreateNote($input: CreateCollaborationNoteInput!) {
    createCollaborationNote(input: $input) {
      __typename
      ... on CreateCollaborationNoteSuccess { edge { node { id } } }
      ${MUTATION_ERROR}
    }
  }
`;

export const UPDATE_NOTE = /* GraphQL */ `
  mutation CameInUpdateNote($input: UpdateCollaborationNoteInput!) {
    updateCollaborationNote(input: $input) {
      __typename
      ... on UpdateCollaborationNoteSuccess { note { id } }
      ${MUTATION_ERROR}
    }
  }
`;

export const CREATE_IDEA = /* GraphQL */ `
  mutation CameInCreateIdea($input: CreateIdeaInput!) {
    createIdea(input: $input) {
      __typename
      ... on Idea { id }
      ... on IdeaResponse { idea { id } }
      ${MUTATION_ERROR}
    }
  }
`;

/** A union result: the success member, or a MutationError's message. */
export interface UnionResult {
  __typename: string;
  message?: string;
}

