// Buffer GraphQL, exactly as plan 1.2 and section 9 have it.

export const ACCOUNT = /* GraphQL */ `
  query CameInAccount {
    account { id name timezone organizations { id name } }
  }
`;

export const CHANNELS = /* GraphQL */ `
  query CameInChannels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id name displayName service type avatar externalLink timezone isDisconnected
    }
  }
`;

export const SENT_POSTS = /* GraphQL */ `
  query CameInSentPosts($organizationId: OrganizationId!, $channelIds: [ChannelId!], $since: DateTime, $after: String, $first: Int!) {
    posts(
      first: $first
      after: $after
      input: {
        organizationId: $organizationId
        filter: { status: [sent], channelIds: $channelIds, dueAt: { start: $since } }
        sort: [{ field: dueAt, direction: desc }]
      }
    ) {
      edges {
        node {
          id text status sentAt dueAt channelId channelService externalLink via
          metadata {
            __typename
            ... on InstagramPostMetadata { type }
            ... on FacebookPostMetadata { type }
            ... on GoogleBusinessPostMetadata { type }
          }
          assets {
            __typename id mimeType source thumbnail type
            ... on ImageAsset { image { width height altText } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export interface BufferChannel {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  type: string;
  avatar: string | null;
  externalLink: string | null;
  timezone: string | null;
  isDisconnected: boolean;
}

export interface BufferAsset {
  __typename: "ImageAsset" | "VideoAsset" | "DocumentAsset" | string;
  id: string | null;
  mimeType: string;
  source: string;
  thumbnail: string;
  type: "image" | "video" | "document";
  image?: { width: number; height: number; altText: string } | null;
}

export interface BufferPost {
  id: string;
  text: string;
  status: string;
  sentAt: string | null;
  dueAt: string | null;
  channelId: string;
  channelService: string;
  externalLink: string | null;
  via: "api" | "buffer" | "network";
  metadata: { __typename: string; type?: string } | null;
  assets: BufferAsset[];
}

export interface PostsPage {
  posts: {
    edges: { node: BufferPost }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}
