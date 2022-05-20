import type { Source, Stream } from 'glider';
import pino from 'pino';

import type { Response } from '../types';

interface Options {
  team: string;
  token: string;
}

class FigmaStream {
  constructor(readonly name: string) {}
}

interface ProjectsStreamOptions {
  teamId: string;
}

class ProjectsStream extends FigmaStream implements Stream {
  readonly teamId: string;

  constructor(options: ProjectsStreamOptions) {
    super('projects');

    this.teamId = options.teamId;
  }

  seed() {
    return `https://api.figma.com/v1/teams/${this.teamId}/projects`;
  }

  transform(raw: string) {
    const data = JSON.parse(raw);
    return data.projects;
  }
}

interface ProjectRecord {
  id: string;
}

interface FileRecord {
  key: string;
}

class FilesStream extends FigmaStream implements Stream {
  constructor(readonly parent: ProjectsStream) {
    super('files');
  }

  seed(context: ProjectRecord) {
    return `https://api.figma.com/v1/projects/${context.id}/files`;
  }

  transform(raw: string) {
    const data = JSON.parse(raw);
    return data.files;
  }
}

class FileCommentsStream extends FigmaStream implements Stream {
  constructor(readonly parent: FilesStream) {
    super('file_comments');
  }

  seed(context: FileRecord) {
    return `https://api.figma.com/v1/files/${context.key}/comments`;
  }

  transform(raw: string) {
    const data = JSON.parse(raw);
    return data.comments;
  }
}

class FileVersionsStream extends FigmaStream implements Stream {
  constructor(readonly parent: FilesStream) {
    super('file_versions');
  }

  seed(context: FileRecord) {
    return `https://api.figma.com/v1/files/${context.key}/versions`;
  }

  // TODO(ptr): This is a huge stream. Use `created_at` incrementalize.
  next(response: Response) {
    const data = JSON.parse(response.body);
    return data.pagination?.next_page ?? null;
  }

  transform(raw: string) {
    const data = JSON.parse(raw);
    return data.versions;
  }
}

export class FigmaSource implements Source {
  readonly name = 'figma';
  readonly streams: Stream[];

  private readonly logger = pino({
    base: {
      source: this.name,
    },
  });

  constructor(private readonly options: Options) {
    const projects = new ProjectsStream({ teamId: options.team });
    const files = new FilesStream(projects);

    this.streams = [
      projects,
      files,
      new FileCommentsStream(files),
      new FileVersionsStream(files),
    ];
  }

  headers() {
    return {
      Accept: 'application/json',
      'X-Figma-Token': this.options.token,
    };
  }

  requestSpacing(response: Response): number {
    if (response.statusCode === 429) {
      this.logger.info({
        msg: `Received 429, backing off for one minute`,
      });

      // Figma asks for a 60s backoff after a 429
      return 60 * 1000;
    }

    return 500;
  }
}
