export interface Practice {
  id: string;
  title: string;
  content: string;
}

export interface PracticesRepository {
  listAll(): Promise<Practice[]>;
  getById(id: string): Promise<Practice | null>;
}
