/* @flow weak */
import config from 'config'
import api from 'backendAPI'
import { autorun } from 'mobx'
import { FsSocketClient } from 'backendAPI/websocketClients'
import store, { getState, dispatch } from 'store'
import mobxStore from 'mobxStore'
import * as TabActions from 'components/Tab/actions'
import * as FileTreeActions from './actions'
import * as GitActions from '../Git/actions'

function handleGitFiles (node) {
  const path = node.path
  const pathArray = path.split('/.git/refs/heads/')
  if (pathArray.length > 1) {
    const branchName = pathArray[1]
    const gitState = getState().GitState
    const current = gitState.branches.current
    if (branchName === current) {
      const history = gitState.history
      const focusedNodes = Object.values(getState().FileTreeState.nodes).filter(node => node.isFocused)
      const historyPath = focusedNodes[0] ? focusedNodes[0].path : '/'
      dispatch(GitActions.fetchHistory({
        path: historyPath,
        size: history.size,
        page: 0,
        reset: true
      }))
      api.gitStatus().then(({ files, clean }) => {
        const gitStatus = mobxStore.FileTreeState.gitStatus
        const result = gitStatus.map(node => {
          const file = files.find(file => ('/' + file.name) === node.path)
          return {
            ...node,
            gitStatus: file ? file.status : 'CLEAN',
          }
        })
        dispatch(
          FileTreeActions.loadNodeData(
            result
          )
        )
      })
    }
    return true
  }
  return false
}

export default function subscribeToFileChange () {
  autorun(() => {
    if (!config.fsSocketConnected) return
    const client = FsSocketClient.$$singleton.stompClient
    client.subscribe('CONNECTED', (frame) => {
      console.log('FS CONNECTED', frame);
    })

    client.subscribe(`/topic/ws/${config.spaceKey}/change`, (frame) => {
      const data = JSON.parse(frame.body)
      const node = data.fileInfo
      switch (data.changeType) {
        case 'create':
          if (handleGitFiles(node)) {
            break
          }
          dispatch(FileTreeActions.loadNodeData([node]))
          break
        case 'modify':
          if (handleGitFiles(node)) {
            break
          }
          dispatch(FileTreeActions.loadNodeData([node]))
          const tabsToUpdate = mobxStore.EditorTabState.tabs.values().filter(tab => tab.path === node.path)
          if (tabsToUpdate.length) {
            api.readFile(node.path).then(({ content }) => {
              dispatch(TabActions.updateTabByPath({
                path: node.path,
                content: { body: content }
              }))
            })
          }
          break
        case 'delete':
          dispatch(FileTreeActions.removeNode(node))
          break
      }
    })

    client.subscribe(`/topic/git/${config.spaceKey}/checkout`, (frame) => {
      const data = JSON.parse(frame.body)
      dispatch(GitActions.updateCurrentBranch({ name: data.branch }))
    })
  })
}
