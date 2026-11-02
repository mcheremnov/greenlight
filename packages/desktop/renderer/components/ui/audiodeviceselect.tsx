import React from 'react'
import { useTranslation } from 'react-i18next'

interface AudioDeviceSelectProps {
    id?: string;
    devices: MediaDeviceInfo[];
    value: string;
    onChange: (deviceId: string) => void;
}

function AudioDeviceSelect({
    id,
    devices,
    value,
    onChange,
}: AudioDeviceSelectProps) {
    const { t } = useTranslation()

    return (
        <select id={id} value={value} onChange={(e) => {
            onChange(e.target.value)
            e.target.blur()
        }}>
            <option value=''>{t('settings.videoAudio.defaultDeviceLabel')}</option>
            {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                    {device.label || t('settings.videoAudio.unnamedDeviceLabel') + ' ' + (index + 1)}
                </option>
            ))}
        </select>
    )
}

export default AudioDeviceSelect
