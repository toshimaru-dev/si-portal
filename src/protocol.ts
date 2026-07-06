import { GoalsFile, HoursFile, ProjectsFile } from './data/types';
import { ImportResult } from './data/outlookImport';

export type WebviewToHostMessage =
  | { type: 'requestData'; domain: 'projects' | 'hours' | 'goals' }
  | { type: 'save'; domain: 'projects'; payload: ProjectsFile }
  | { type: 'save'; domain: 'hours'; payload: HoursFile }
  | { type: 'save'; domain: 'goals'; payload: GoalsFile }
  | { type: 'openFile'; domain: 'projects' | 'goals' }
  | { type: 'importOutlook'; payload: { csvText: string } }
  | { type: 'assign'; payload: { eventKey: string; subject: string; projectId: string; addRule: boolean } };

export type HostToWebviewMessage =
  | { type: 'data'; domain: 'projects'; payload: ProjectsFile }
  | { type: 'data'; domain: 'hours'; payload: HoursFile }
  | { type: 'data'; domain: 'goals'; payload: GoalsFile }
  | { type: 'importResult'; payload: ImportResult }
  | { type: 'fileChanged'; domain: 'projects' | 'hours' | 'goals' }
  | { type: 'saved'; domain: 'projects' | 'hours' | 'goals' }
  | { type: 'error'; message: string };
