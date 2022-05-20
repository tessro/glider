export interface Response {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  statusCode: number;
}
