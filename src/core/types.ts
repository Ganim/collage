export interface Size {
  widthMm: number
  heightMm: number
}

export interface Photo {
  id: string
  width: number
  height: number
  name: string
}

/** cx and cy are fractions of the frame; widthFrac is the unrotated photo width as a fraction of the frame width. */
export interface Layer {
  id: string
  photoId: string
  cx: number
  cy: number
  widthFrac: number
  rotationDeg: number
}

/** layers[0] is the background. */
export interface Frame extends Size {
  id: string
  layers: Layer[]
}

export interface Paper extends Size {
  marginMm: number
  gapMm: number
}

export interface Collection {
  schemaVersion: 1
  id: string
  name: string
  photoIds: string[]
  frames: Frame[]
  paper: Paper
  updatedAt: number
}

export type SavedSize = Size & { id: string; name: string }
