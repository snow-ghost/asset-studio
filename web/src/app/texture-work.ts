// The texture asset being worked on: what is shown, where its pixels came from and whether they must be
// written on the next save. Three origins, three save behaviours (spec 002): an imported PNG goes out byte
// for byte; a recipe is rendered; an opened asset whose pixels were not touched is not re-uploaded at all.
// Kept apart from the session so the session stays about the designer's actions, not about pixel sources.

import { DEFAULT_TEXTURE_PARAMS, generateTexture, parseTextureParams, validTextureParams, type TextureParams } from '../domain/texture';
import type { SceneObject, TextureCodec, TextureSource } from './ports';

export type RecipeChange = { ok: true; object: SceneObject } | { ok: false; reason: string };

export class TextureWork {
  private source: TextureSource | null = null;
  private recipe: TextureParams | null = null;
  private importedBytes: ArrayBuffer | null = null;
  private pixelsDirty = false;

  constructor(private readonly textures: TextureCodec) {}

  get procedural(): TextureParams | null {
    return this.recipe;
  }

  size(): { width: number; height: number } | null {
    return this.source ? { width: this.source.width, height: this.source.height } : null;
  }

  /** startRecipe is a new texture placeholder: default numbers, pixels still to be written. Returns the preview. */
  startRecipe(): SceneObject {
    this.importedBytes = null;
    this.pixelsDirty = true;
    return this.render(DEFAULT_TEXTURE_PARAMS);
  }

  /** fromImport takes a PNG from disk; its bytes are kept and saved exactly as they came. */
  async fromImport(bytes: ArrayBuffer): Promise<SceneObject> {
    this.source = await this.textures.fromBytes(bytes);
    this.recipe = null;
    this.importedBytes = bytes;
    this.pixelsDirty = false;
    return this.textures.plane(this.source);
  }

  /**
   * fromAsset opens a stored texture: the file's pixels are shown — they are what the game sees — and the
   * recipe, if the metadata carries one the studio can read, is what a parameter change re-renders from.
   */
  async fromAsset(url: string, procedural: unknown): Promise<SceneObject> {
    this.source = await this.textures.fromUrl(url);
    this.recipe = parseTextureParams(procedural);
    this.importedBytes = null;
    this.pixelsDirty = false;
    return this.textures.plane(this.source);
  }

  /** setParams changes the recipe and re-renders it; a picture has no recipe and says so. */
  setParams(patch: Partial<TextureParams>): RecipeChange {
    if (!this.recipe) {
      return { ok: false, reason: 'this texture is a picture, not a recipe — only a procedural texture has parameters' };
    }
    const next: TextureParams = { ...this.recipe, ...patch };
    if (!validTextureParams(next)) {
      return {
        ok: false,
        reason: 'a texture recipe needs a known type and size, two #rrggbb colours, a scale from 1 to 256 and a whole seed',
      };
    }
    this.importedBytes = null;
    this.pixelsDirty = true;
    return { ok: true, object: this.render(next) };
  }

  /** payload is what a save carries: nothing for an opened, untouched asset; the file as it came; or the rendered recipe. */
  async payload(stored: boolean): Promise<ArrayBuffer | null> {
    if (!this.source) throw new Error('no texture to save');
    if (stored && !this.pixelsDirty) return null;
    if (this.importedBytes) return this.importedBytes;
    return this.textures.encode(this.source);
  }

  markSaved(): void {
    this.pixelsDirty = false;
  }

  forget(): void {
    this.source = null;
    this.recipe = null;
    this.importedBytes = null;
    this.pixelsDirty = false;
  }

  private render(params: TextureParams): SceneObject {
    this.recipe = params;
    this.source = this.textures.fromPixels(generateTexture(params));
    return this.textures.plane(this.source);
  }
}
