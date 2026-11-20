import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCPou, PLCProject } from '@root/types/PLC/open-plc'

export * from './create-project'
export * from './project-files-schema'
export * from './project-recent-history'

export type SaveProjectRequest = {
  projectPath: string
  content: {
    projectData: PLCProject
    pous: PLCPou[]
    deviceConfiguration: DeviceConfiguration
    devicePinMapping: DevicePin[]
  }
}

export type SaveProjectAsResponse = {
  success: boolean
  canceled?: boolean
  projectPath?: string
  error?: string
}

export type IProjectServiceResponse = {
  success: boolean
  error?: {
    title: string
    description: string
    error: unknown
  }
  message?: string
  data?: {
    meta: {
      path: string
    }
    content: {
      project: PLCProject
      pous: PLCPou[]
      deviceConfiguration: DeviceConfiguration
      devicePinMapping: DevicePin[]
    }
  }
}
