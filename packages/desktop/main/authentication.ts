import { session, dialog, shell, clipboard } from 'electron'
import { createWindow } from './helpers'
import Application from './application'
import { Msal } from 'xal-node'
import AuthTokenStore from './helpers/tokenstore'
import i18n from 'i18next';


export default class Authentication {
    _application:Application

    _tokenStore:AuthTokenStore
    _msal:Msal

    _authWindow
    _authCallback
    _deviceCodeDialog:AbortController

    _isAuthenticating:boolean = false
    _isAuthenticated:boolean = false
    _appLevel:number = 0

    private t = i18n.t.bind(i18n);

    constructor(application:Application){
        this._application = application
        this._tokenStore = new AuthTokenStore()
        this._tokenStore.load()
        this._msal = new Msal(this._tokenStore)
    }

    checkAuthentication(){
        this._application.log('authenticationV2', '[checkAuthentication()] Starting token check...')
        if(this._tokenStore.hasValidAuthTokens()){

            // Deprecate xal token.
            if(this._tokenStore.getUserToken() !== undefined && this._tokenStore.getUserToken().data.scope != 'XboxLive.signin'){
                this._application.log('authenticationV2', '[checkAuthentication()] Deprecating old XAL token scope. Starting auth flow to get new tokens.')
                return false
            }

            this._application.log('authenticationV2', '[checkAuthentication()] Tokens are valid:', this._tokenStore.getUserToken())
            this.startSilentFlow()

            return true

        } else {
            if(this._tokenStore.getUserToken() !== undefined){
                // We have a user token, lets try to refresh it.
                this._application.log('authenticationV2', '[checkAuthentication()] Tokens are expired but we have a user token. Lets try to refresh the tokens.')
                this.startSilentFlow()

                return true

            } else {
                this._application.log('authenticationV2', '[checkAuthentication()] No tokens are present.')
                return false
            }
        }
    }

    startSilentFlow(){
        this._application.log('authenticationV2', '[startSilentFlow()] Starting silent flow...')
        this._isAuthenticating = true

        const forceRegionIp = this._application._store.get('force_region_ip', '')
        if (forceRegionIp && typeof forceRegionIp === 'string' && forceRegionIp.trim() !== '') {
            this._msal.setDefaultHeaders({ 'X-Forwarded-For': forceRegionIp.trim() })
            this._application.log('authenticationV2', '[startSilentFlow()] Using X-Forwarded-For:', forceRegionIp)
        } else {
            this._msal.setDefaultHeaders({})
        }

        this.getTokens()
    }

    getTokens(){
        this.getStreamingToken().then((streamingTokens) => {
            this._application.log('authenticationV2', '[getTokens()] Retrieved streaming tokens:', streamingTokens)

            if(streamingTokens.xCloudToken !== undefined){
                this._application.log('authenticationV2', '[getTokens()] Retrieved both xHome and xCloud tokens')
                this._appLevel = 2
            } else {
                this._application.log('authenticationV2', '[getTokens()] Retrieved xHome token only')
                this._appLevel = 1
            }

            this._msal.getWebToken().then((webToken) => {
                this._application.log('authenticationV2', __filename+'[getTokens()] Web token received')
                this._application.authenticationCompleted(streamingTokens, webToken)

            }).catch((error) => {
                this._application.log('authenticationV2', __filename+'[getTokens()] Failed to retrieve web tokens:', error)
                dialog.showMessageBox({
                    message: this.t('errors.failedToRetrieveWebTokens') + ' ' + JSON.stringify(error),
                    type: 'error',
                })
            })

        }).catch((err) => {
            this._application.log('authenticationV2', '[startSilentFlow()] Failed to retrieve streaming tokens:', err)
            dialog.showMessageBox({
                message: "Failed to retrieve streaming tokens. Please sign in again.",
                type: 'error',
            })
            // @TODO: If we fail to get streaming tokens, we should probably start the auth flow to let the user re-authenticate and get new tokens.
            this.startAuthflow()
        })
    }

    startAuthflow(){
        this._application.log('authenticationV2', '[startAuthflow()] Starting authentication flow')

        const forceRegionIp = this._application._store.get('force_region_ip', '')
        if (forceRegionIp && typeof forceRegionIp === 'string' && forceRegionIp.trim() !== '') {
            this._msal.setDefaultHeaders({ 'X-Forwarded-For': forceRegionIp.trim() })
            this._application.log('authenticationV2', '[startSilentFlow()] Using X-Forwarded-For:', forceRegionIp)
        } else {
            this._msal.setDefaultHeaders({})
        }

        this._msal.doDeviceCodeAuth().then((data) => {
            this._application.log('authenticationV2', '[startAuthflow()] Starting devicecode auth:', data)

            this.openDeviceCodeLink(data.verification_uri, data.user_code)

            this._isAuthenticating = true

            this._msal.doPollForDeviceCodeAuth(data.device_code).then((token) => {
                this._application.log('authenticationV2', '[startAuthflow()] Devicecode authentication successful:', token)

                this._deviceCodeDialog?.abort()
                this.getTokens()

            }).catch((error) => {
                this._deviceCodeDialog?.abort()
                this._application.log('authenticationV2', '[startAuthflow()] Error during devicecode polling auth:', error)
                dialog.showErrorBox('Error', 'Failed to perform MSAL authentixation: ' + JSON.stringify(error))

                this._isAuthenticating = false
            })

        }).catch((error) => {
            this._application.log('authenticationV2', '[startAuthflow()] Error during devicecode auth:', error)
            dialog.showErrorBox('Error', this.t('errors.errorAuthentificationUser') + ' ' + JSON.stringify(error))
        })
    }

    openDeviceCodeLink(verificationUri:string, userCode:string){
        // otc prefills the code on microsoft.com/link so the user only has to confirm
        const url = verificationUri + '?otc=' + encodeURIComponent(userCode)

        clipboard.writeText(userCode)
        shell.openExternal(url)

        this._deviceCodeDialog = new AbortController()
        this.showDeviceCodeDialog(url, verificationUri, userCode)
    }

    showDeviceCodeDialog(url:string, verificationUri:string, userCode:string){
        dialog.showMessageBox({
            type: 'info',
            title: 'Sign in with Microsoft',
            message: 'Sign in with your browser',
            detail: 'A browser window has opened. If it did not, go to ' + verificationUri + ' and enter this code:\n\n' + userCode + '\n\nThe code has been copied to your clipboard. Greenlight will continue automatically after you sign in.',
            buttons: ['OK', 'Open browser', 'Copy code'],
            defaultId: 0,
            cancelId: 0,
            signal: this._deviceCodeDialog.signal,
        }).then(({ response }) => {
            if(response === 0 || this._deviceCodeDialog.signal.aborted)
                return

            if(response === 1){
                shell.openExternal(url)
            } else {
                clipboard.writeText(userCode)
            }
            // Keep the code visible until the user dismisses it
            this.showDeviceCodeDialog(url, verificationUri, userCode)
        })
    }

    getAccounts(){
        return this._application._store.get('accounts.list', {}) as Record<string, any>
    }

    getActiveAccount(){
        return this._application._store.get('accounts.active', '') as string
    }

    // Snapshot the signed in user (tokens + cached profile) into the accounts list
    saveActiveAccount(xuid?:string){
        const store = this._application._store
        if(xuid === undefined)
            xuid = this.getActiveAccount()

        if(! xuid || store.get('user.tokenstore') === undefined)
            return

        store.set('accounts.list.'+xuid, {
            xuid: xuid,
            gamertag: store.get('user.gamertag', ''),
            gamerpic: store.get('user.gamerpic', ''),
            gamerscore: store.get('user.gamerscore', ''),
            tokenstore: store.get('user.tokenstore'),
        })
        store.set('accounts.active', xuid)
    }

    switchAccount(xuid:string){
        const account = this.getAccounts()[xuid]
        if(account === undefined)
            throw new Error('Account not found: '+xuid)

        this.saveActiveAccount()

        const store = this._application._store
        store.delete('user')
        store.set('user.tokenstore', account.tokenstore)
        store.set('user.gamertag', account.gamertag)
        store.set('user.gamerpic', account.gamerpic)
        store.set('user.gamerscore', account.gamerscore)
        store.set('accounts.active', xuid)

        this._application.restart()
    }

    addAccount(){
        this.saveActiveAccount()

        // Without tokens the app starts the sign in flow after restart
        this._application._store.delete('user')
        this._application._store.set('accounts.active', '')
        this._application.restart()
    }

    removeAccount(xuid:string){
        const store = this._application._store
        const isActive = (xuid === this.getActiveAccount())
        store.delete('accounts.list.'+xuid as any)

        if(! isActive)
            return

        store.delete('user')
        store.set('accounts.active', '')

        const remaining = Object.keys(this.getAccounts())
        if(remaining.length > 0){
            this.switchAccount(remaining[0])
        } else {
            this._application.restart()
        }
    }

    openAuthWindow(url){
        const authWindow = createWindow('auth', {
            width: 500,
            height: 600,
            title: this.t('auth.windowTitle'),
        })

        authWindow.loadURL(url)
        this._authWindow = authWindow

        this._authWindow.on('close', () => {
            this._application.log('authenticationV2', '[openAuthWindow()] Closed auth window')
            // @TODO: What to do?
        })
    }

    async getStreamingToken(){
        const userToken = this._tokenStore.getUserToken()
        if(userToken === undefined)
            throw new Error( this.t('errors.sisuTokenIsMissing') )

        this._application.log('authenticationV2', '[getStreamingToken()] Found local token:', userToken)

        const streamingTokens = await this._msal.getStreamingTokens()
        this._application.log('authenticationV2', '[getStreamingToken()] Retrieved streaming tokens:', streamingTokens)

        return { xHomeToken: streamingTokens.xHomeToken, xCloudToken: streamingTokens.xCloudToken }
        // return { xHomeToken: streamingTokens.xHomeToken, xCloudToken: undefined }
    }


}
