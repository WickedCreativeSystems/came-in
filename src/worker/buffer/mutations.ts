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

export const EDIT_POST_TAGS = /* GraphQL */ `
  mutation CameInEditPostTags($input: EditPostInput!) {
    editPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id tags { id } } }
      ${MUTATION_ERROR}
    }
  }
`;

export const POST_TAGS = /* GraphQL */ `
  query CameInPostTags($id: PostId!) {
    post(input: { id: $id }) { id tags { id name } }
  }
`;

export const TAGS = /* GraphQL */ `
  query CameInTags($organizationId: OrganizationId!) {
    tagsV2(first: 100, input: { organizationId: $organizationId }) {
      edges { node { id name color isLocked } }
    }
  }
`;

export const CREATE_TAG = /* GraphQL */ `
  mutation CameInCreateTag($input: CreateTagInput!) {
    createTag(input: $input) {
      __typename
      ... on TagActionSuccess { tag { id name } }
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

export const TAG_NAME = "Came in";
export const TAG_COLOR = "#C4912C"; // brass; the one place Came In's brass goes into Buffer (plan 1.2)
