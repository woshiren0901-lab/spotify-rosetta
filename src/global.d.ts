export interface SpicetifyPlayerItem {
  uri?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  artist?: string;
  album?: { name?: string };
  duration?: { milliseconds?: number };
  metadata?: Record<string, string>;
}

export interface SpicetifyPlayerData {
  item?: SpicetifyPlayerItem;
  isPaused?: boolean;
}

export interface SpicetifyCosmosAsync {
  get<T = unknown>(
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T>;
  post<T = unknown>(
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T>;
}

export interface SpicetifyPlaybarButton {
  element?: HTMLButtonElement;
  register(): void;
  deregister?(): void;
  active?: boolean;
}

export interface SpicetifyApi {
  Player?: {
    data?: SpicetifyPlayerData;
    addEventListener?: (event: string, callback: () => void) => void;
    removeEventListener?: (event: string, callback: () => void) => void;
    getProgress?: () => number;
    seek?: (milliseconds: number) => void;
    isPlaying?: () => boolean;
  };
  CosmosAsync?: SpicetifyCosmosAsync;
  LocalStorage?: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };
  Playbar?: {
    Button?: new (
      label: string,
      icon: string,
      onClick: () => void,
      disabled?: boolean,
      active?: boolean,
      register?: boolean,
    ) => SpicetifyPlaybarButton;
  };
  showNotification?: (message: string, isError?: boolean) => void;
}

export interface DocumentPictureInPictureApi {
  readonly window?: Window | null;
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
  }): Promise<Window>;
}

declare global {
  interface Window {
    Spicetify?: SpicetifyApi;
    documentPictureInPicture?: DocumentPictureInPictureApi;
    SpotifyRosetta?: {
      dispose(): void;
      refresh(): Promise<void>;
      debug(): unknown;
    };
  }

  const Spicetify: SpicetifyApi;
}

export {};

