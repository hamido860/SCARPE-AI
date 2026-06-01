export interface DictionaryItem {
  id: string;
  nameAr: string;
  nameFr: string;
  suffix: string;
  keywords: string[];
}

export interface TopicItem extends DictionaryItem {
  subjectId: string;
}

export interface Dictionary {
  grades: DictionaryItem[];
  subjects: DictionaryItem[];
  topics: TopicItem[];
  allowedDocumentTypes: DictionaryItem[];
}
