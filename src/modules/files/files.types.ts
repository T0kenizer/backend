import { Job, Queue } from 'bullmq';

export enum FileJob {
  Upload = 'upload',
}

export interface UploadJobData {
  fileUuid: string;
  contentBase64: string;
}

export type FileJobData = {
  [FileJob.Upload]: UploadJobData;
};

export type FilesQueueJob = {
  [Name in FileJob]: Job<FileJobData[Name], void, Name>;
}[FileJob];

export type FilesQueue = Queue<FileJobData[FileJob], void, FileJob>;
