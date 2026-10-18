// dsh-always-on-top client half: a tiny pin button in the window title bar.
// No build step and no imports: the loader injects this file as a plain script.

window.__ModuleLoader__.load({
  id: 'dsh-always-on-top',
  factory: function () {
    var module = { exports: {} }
    var exports = module.exports

    var API = '/dsh-always-on-top'
    var ZH = String(navigator.language || '').toLowerCase().indexOf('zh') === 0

    var TEXT = ZH
      ? {
          pin: '置顶窗口',
          unpin: '取消置顶',
          pinned: '已置顶，点击取消',
          failed: '置顶失败',
          unsupported: '仅支持 DSH Desktop（Windows）',
        }
      : {
          pin: 'Always on top',
          unpin: 'Stop always on top',
          pinned: 'Always on top — click to unpin',
          failed: 'Could not pin the window',
          unsupported: 'DSH Desktop on Windows only',
        }

    var ICON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 17v5"/>' +
      '<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>' +
      '</svg>'

    var CSS = [
      '#dsh-always-on-top{position:fixed;top:7px;right:146px;z-index:2147483000;width:28px;height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.55;cursor:pointer;-webkit-app-region:no-drag;app-region:no-drag;transition:opacity .15s ease,background-color .15s ease,color .15s ease,transform .12s ease;user-select:none;-webkit-user-select:none}',
      /* Follow the title bar the OS actually gives us (Window Controls Overlay), so a
         future DSH release that resizes the caption buttons or the bar keeps the pin
         pinned next to the minimize button. clamp() keeps a bad env value on screen. */
      '#dsh-always-on-top{top:clamp(2px,calc(env(titlebar-area-y,0px) + (env(titlebar-area-height,42px) - 28px)/2),20px);right:clamp(8px,calc(100vw - env(titlebar-area-x,0px) - env(titlebar-area-width,calc(100vw - 138px)) + 8px),260px)}',
      '#dsh-always-on-top:hover{opacity:1;background:color-mix(in srgb,currentColor 10%,transparent)}',
      '#dsh-always-on-top:active{transform:scale(.9)}',
      '#dsh-always-on-top:focus-visible{outline:2px solid #4d6bfe;outline-offset:1px;opacity:1}',
      '#dsh-always-on-top svg{display:block;width:16px;height:16px}',
      '#dsh-always-on-top.is-on{opacity:1;color:#4d6bfe;background:color-mix(in srgb,#4d6bfe 15%,transparent)}',
      '#dsh-always-on-top.is-on:hover{background:color-mix(in srgb,#4d6bfe 24%,transparent)}',
      '#dsh-always-on-top.is-busy{opacity:.4;cursor:progress;pointer-events:none}',
      '#dsh-always-on-top.is-error{opacity:1;color:#e5484d}',
      '@media (prefers-color-scheme:dark){#dsh-always-on-top.is-on{color:#8ba2ff;background:color-mix(in srgb,#8ba2ff 18%,transparent)}}',
    ].join('\n')

    var button = null
    var style = null
    var pinned = false
    var busy = false
    var errorTimer = null

    function render() {
      if (!button) return
      button.classList.toggle('is-on', pinned)
      button.classList.toggle('is-busy', busy)
      button.setAttribute('aria-pressed', pinned ? 'true' : 'false')
      button.title = pinned ? TEXT.pinned : TEXT.pin
      button.setAttribute('aria-label', pinned ? TEXT.unpin : TEXT.pin)
    }

    function api(path, body) {
      var options = { cache: 'no-store', credentials: 'same-origin' }
      if (body !== undefined) {
        options.method = 'POST'
        options.headers = { 'Content-Type': 'application/json' }
        options.body = JSON.stringify(body)
      }
      return fetch(API + path, options).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
    }

    function flashError(message) {
      if (!button) return
      button.classList.add('is-error')
      button.title = TEXT.failed + ': ' + message
      if (errorTimer) clearTimeout(errorTimer)
      errorTimer = setTimeout(function () {
        if (!button) return
        button.classList.remove('is-error')
        render()
      }, 3000)
    }

    function applyState(data) {
      if (!data || data.supported === false) {
        remove()
        return
      }
      pinned = data.pinned === true
      render()
    }

    function toggle() {
      if (busy) return
      busy = true
      render()
      api('/toggle', {}).then(
        function (data) {
          busy = false
          applyState(data)
        },
        function (error) {
          busy = false
          render()
          flashError(error && error.message ? error.message : String(error))
        },
      )
    }

    function restore(desired) {
      if (!desired || pinned) return
      api('/set', { on: true }).then(
        function (data) {
          applyState(data)
        },
        function () {
          /* keep the unpinned state when the window is not ready yet */
        },
      )
    }

    function remove() {
      if (errorTimer) clearTimeout(errorTimer)
      if (button && button.parentNode) button.parentNode.removeChild(button)
      if (style && style.parentNode) style.parentNode.removeChild(style)
      button = null
      style = null
    }

    function apply(ctx) {
      if (document.getElementById('dsh-always-on-top')) return

      style = document.createElement('style')
      style.id = 'dsh-always-on-top-style'
      style.textContent = CSS
      ;(document.head || document.documentElement).appendChild(style)

      button = document.createElement('button')
      button.id = 'dsh-always-on-top'
      button.type = 'button'
      button.className = 'dsh-always-on-top'
      button.innerHTML = ICON
      button.dataset.tip = TEXT.pin
      button.title = TEXT.pin
      button.setAttribute('aria-label', TEXT.pin)
      button.setAttribute('aria-pressed', 'false')
      button.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        toggle()
      })
      ;(document.body || document.documentElement).appendChild(button)
      render()

      api('/status').then(
        function (data) {
          if (!data || data.supported === false) {
            remove()
            return
          }
          applyState(data)
          restore(data.desired === true)
        },
        function () {
          /* host route not ready: leave the button in its idle state */
        },
      )

      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return remove
        }, 'dsh-always-on-top: pin button')
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
