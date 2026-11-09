import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useEditor } from '../../state/editor'
import { sizeListText } from '../build/sizeText'
import { BottomSheet } from '../components/BottomSheet'
import { t } from '../i18n'

export function SizesScreen({ onClose }: { onClose: () => void }) {
  const sizes = useEditor((s) => s.savedSizes)
  const deleteSize = useEditor((s) => s.deleteSize)
  const [failed, setFailed] = useState(false)

  const remove = async (id: string) => {
    setFailed(false)
    try {
      await deleteSize(id)
    } catch (e) {
      console.error(e)
      setFailed(true)
    }
  }

  return (
    <BottomSheet title={t('sizes.title')} onClose={onClose}>
      {sizes.length === 0 ? (
        <p className="library-empty">{t('sizes.empty')}</p>
      ) : (
        <ul className="library-list">
          {sizes.map((size) => (
            <li key={size.id} className="library-row">
              <div className="library-info">
                <span>{size.name}</span>
                <small>{sizeListText(size)}</small>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t('library.delete', { name: size.name })}
                onClick={() => void remove(size.id)}
              >
                <Trash2 size={20} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p className="library-error" role="status">
          {t('sizes.deleteFailed')}
        </p>
      )}
    </BottomSheet>
  )
}
