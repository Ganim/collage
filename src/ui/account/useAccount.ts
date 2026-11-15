import { useCallback, useEffect, useState } from 'react'
import { loadAccount, signOut as endSession, type Account } from './account'

export type AccountStatus = 'checking' | 'in' | 'out'

export function useAccount(): {
  status: AccountStatus
  account: Account | null
  signOut(): Promise<void>
} {
  const [status, setStatus] = useState<AccountStatus>('checking')
  const [account, setAccount] = useState<Account | null>(null)

  useEffect(() => {
    let current = true
    void loadAccount().then((found) => {
      if (!current) return
      setAccount(found)
      setStatus(found ? 'in' : 'out')
    })
    return () => {
      current = false
    }
  }, [])

  const signOut = useCallback(async () => {
    await endSession()
    setAccount(null)
    setStatus('out')
  }, [])

  return { status, account, signOut }
}
