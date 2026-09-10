// The manifest is the bridge to wowd (docs/integration-with-wowd.md): the map from a content id the game
// already owns to the asset file that draws it. These types mirror api.Manifest on the Go side and are
// what wowd's client will import once the loader exists (roadmap M6); keep them in step with the server.

import type { Format, Kind } from './asset';

export interface ManifestEntry {
  wowdRef: string;
  kind: Kind;
  format: Format;
  assetId: string;
  name: string;
  /** Path of the payload, relative to the studio origin. */
  url: string;
}

export interface Manifest {
  version: number;
  generated: string;
  assets: ManifestEntry[];
}
