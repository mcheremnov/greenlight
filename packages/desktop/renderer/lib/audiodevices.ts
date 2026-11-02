import React from 'react'

export interface AudioDevices {
    inputs: MediaDeviceInfo[];
    outputs: MediaDeviceInfo[];
    refresh: () => void;
}

// Chromium lists aliases for the system default device. We use '' for "system default" instead.
const aliasDeviceIds = ['default', 'communications']

export function useAudioDevices(): AudioDevices {
    const [inputs, setInputs] = React.useState<MediaDeviceInfo[]>([])
    const [outputs, setOutputs] = React.useState<MediaDeviceInfo[]>([])

    const refresh = React.useCallback(() => {
        navigator.mediaDevices.enumerateDevices().then((devices) => {
            const realDevices = devices.filter(device => !aliasDeviceIds.includes(device.deviceId))
            setInputs(realDevices.filter(device => device.kind === 'audioinput'))
            setOutputs(realDevices.filter(device => device.kind === 'audiooutput'))
        }).catch((error) => {
            console.error('AudioDevices: failed to enumerate devices:', error)
        })
    }, [])

    React.useEffect(() => {
        refresh()
        navigator.mediaDevices.addEventListener('devicechange', refresh)

        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', refresh)
        }
    }, [refresh])

    return { inputs, outputs, refresh }
}

// Same constraints as xbox-xcloud-player's ChatChannel.startMic, plus the selected device.
// Falls back to the system default when the saved device is no longer available.
export function getMicStream(deviceId: string): Promise<MediaStream> {
    const constraints = {
        channelCount: 1,
        sampleRate: 24e3,
    }

    if(deviceId === '') {
        return navigator.mediaDevices.getUserMedia({ audio: constraints })
    }

    return navigator.mediaDevices.getUserMedia({
        audio: { ...constraints, deviceId: { exact: deviceId } },
    }).catch((error) => {
        if(error.name === 'OverconstrainedError' || error.name === 'NotFoundError') {
            console.warn('AudioDevices: input device not found, using system default:', deviceId)
            return navigator.mediaDevices.getUserMedia({ audio: constraints })
        }
        throw error
    })
}
