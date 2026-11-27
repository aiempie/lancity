import { describe, expect, it } from 'vitest'
import { LOCAL_MAX_FILE_SIZE, LocalAssetStore } from './harness/local-files'

const image = (name = 'a.png', size = 4) => new File([new Uint8Array(size)], name, { type: 'image/png' })

describe('harness file handler', () => {
  it('uploads with progress and returns numeric asset ids like Lancity', async () => {
    const progress: [string, number | undefined][] = []
    const store = new LocalAssetStore({
      stepMs: 0,
      onProgress: (blockId, percent) => progress.push([blockId, percent])
    })
    const handler = store.handler()
    const first = await handler.upload('block-1', image())
    const second = await handler.upload('block-2', image('b.png'))
    expect([first, second]).toEqual(['1', '2'])
    expect(progress.filter(([id]) => id === 'block-1').map(([, percent]) => percent)).toEqual([
      10,
      35,
      60,
      85,
      100,
      undefined
    ])
    expect(await handler.getAssetSrc('1')).toMatch(/^blob:/)
    expect(await handler.getAssetDownloadSrc('1')).toBe(await handler.getAssetSrc('1'))
    expect(handler.validation.maxFileSize).toBe(LOCAL_MAX_FILE_SIZE)
  })

  it('keeps URLs of older content and resolves unknown ids to nothing', async () => {
    const handler = new LocalAssetStore().handler()
    expect(await handler.getAssetSrc('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(await handler.getAssetSrc('99')).toBe('')
    expect(await handler.getAssetSrc('not-an-id')).toBe('')
    expect(await handler.checkIfAssetExists('99')).toBe(false)
  })

  it('deletes, restores and duplicates assets', async () => {
    const handler = new LocalAssetStore({ stepMs: 0 }).handler()
    const id = await handler.upload('block', image())
    await handler.delete(id)
    expect(await handler.checkIfAssetExists(id)).toBe(false)
    expect(await handler.getAssetSrc(id)).toBe('')
    await handler.restore(id)
    expect(await handler.checkIfAssetExists(id)).toBe(true)
    const copy = await handler.duplicate(id)
    expect(copy).toBe('2')
    expect(await handler.getAssetSrc(copy)).toBe(await handler.getAssetSrc(id))
    await expect(handler.duplicate('42')).rejects.toThrow()
  })

  it('refuses files over the limit and can cancel an upload', async () => {
    const store = new LocalAssetStore({ stepMs: 5 })
    await expect(store.upload('big', image('big.png', LOCAL_MAX_FILE_SIZE + 1))).rejects.toThrow()
    const upload = store.upload('slow', image())
    store.cancel()
    await expect(upload).rejects.toThrow('Upload cancelled')
  })
})
