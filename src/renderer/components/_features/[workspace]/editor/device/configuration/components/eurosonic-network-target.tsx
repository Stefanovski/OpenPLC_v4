import { INPUT_STYLES } from '@data/constants/device-styles'
import { zodResolver } from '@hookform/resolvers/zod'
import { staticHostSelectors } from '@hooks/use-store-selectors'
import { InputWithRef, Label } from '@root/renderer/components/_atoms'
import { DeviceDiscoveryDialog } from '@root/renderer/components/_molecules/discovery/device-discovery-dialog'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'

const targetIpSchema = z.object({
  ipAddress: z.string().ip(),
})

type TargetIpSchema = z.infer<typeof targetIpSchema>

export const EurosonicNetworkTarget = () => {
  const tcpStaticHostConfiguration = staticHostSelectors.useTcpStaticHostConfiguration()
  const setStaticHostConfiguration = staticHostSelectors.useSetStaticHostConfiguration()
  const {
    control,
    setValue,
    formState: { errors },
  } = useForm<TargetIpSchema>({
    mode: 'onChange',
    resolver: zodResolver(targetIpSchema),
    defaultValues: { ipAddress: tcpStaticHostConfiguration.ipAddress },
  })

  return (
    <div className='flex w-full flex-wrap items-end gap-6'>
      <div className='flex w-full max-w-[360px] flex-col gap-2'>
        <Label htmlFor='eurosonic-target-ip' className='text-xs text-neutral-950 dark:text-white'>
          Target IP
        </Label>
        <Controller
          name='ipAddress'
          control={control}
          render={({ field }) => (
            <InputWithRef
              id='eurosonic-target-ip'
              placeholder='192.168.200.182'
              {...field}
              onBlur={() => {
                field.onBlur()
                if (targetIpSchema.safeParse({ ipAddress: field.value }).success) {
                  setStaticHostConfiguration({ ipAddress: field.value })
                }
              }}
              className={errors.ipAddress ? INPUT_STYLES.error : INPUT_STYLES.default}
            />
          )}
        />
      </div>
      <DeviceDiscoveryDialog
        onSelectIp={(ipAddress) => {
          setValue('ipAddress', ipAddress, { shouldValidate: true, shouldDirty: true })
          setStaticHostConfiguration({ ipAddress })
        }}
      />
    </div>
  )
}
