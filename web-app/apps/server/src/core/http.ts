import type { Response } from 'express'
import type { ApiResponse } from '@maintainx/shared'

export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: ApiResponse<T> = { data }
  res.status(status).json(body)
}

export function sendCreated<T>(res: Response, data: T): void {
  sendData(res, data, 201)
}

export function sendNoContent(res: Response): void {
  res.status(204).end()
}
