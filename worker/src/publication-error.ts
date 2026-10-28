export class PublicationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
