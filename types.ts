
export enum Subject {
  BANGLA = 'Bangla 2nd Paper (Grammar)',
  ENGLISH = 'English (Grammar/Vocab)',
  MATH = 'Math (Arithmetic/Algebra)',
  GK = 'GK (History/Geography/Current Affairs)',
  UNKNOWN = 'Unknown'
}

export enum OutputLanguage {
  BN = 'BN',
  EN = 'EN'
}

export interface ProcessingResult {
  ocrText: string;
  subject: Subject;
}

export interface MCQQuestion {
  id: number;
  question: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
  };
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  briefExplanation: string;
  sourceTag: string;
  covers: string[];
}

export interface Flashcard {
  id: number;
  question: string;
}

export interface MCQBatch {
  batchNumber: number;
  questions: MCQQuestion[];
  coverageReport: {
    usedFactsCount: number;
    unusedFactsCount: number;
    unusedFactsPreview: string[];
  };
}

export interface AppState {
  images: string[];
  processing: boolean;
  ocrResult: ProcessingResult | null;
  masterNote: {
    layer1: string;
    layer2: string;
    layer3: string;
  } | null;
  summary: string | null;
  mcqBatches: MCQBatch[];
  flashcards: Flashcard[];
  language: OutputLanguage;
  activeTab: 'master' | 'summary' | 'practice' | 'flashcards' | 'mistakes';
  currentQuestionIndex: number;
  userAnswers: Record<number, string>;
  examFinished: boolean;
}
