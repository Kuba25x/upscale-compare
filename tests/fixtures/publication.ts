import { publicationHeaders, randomHex } from '../../shared/publication';
export const testDeletionToken = 'ab'.repeat(32);
export const testPublicationCredentials = () => ({
  key: `${Date.now()}.${randomHex(32)}`,
  deleteToken: testDeletionToken,
});
export const testPublicationHeaders = () => publicationHeaders(testPublicationCredentials());
