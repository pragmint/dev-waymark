import type { AppStateRepository } from './repository';

let _repo: AppStateRepository | null = null;

export function initAppStateRepo(repo: AppStateRepository): void {
  _repo = repo;
}

export function getAppStateRepo(): AppStateRepository {
  if (!_repo) {
    throw new Error('App state repository not initialized. Call initAppStateRepo() at startup.');
  }
  return _repo;
}
