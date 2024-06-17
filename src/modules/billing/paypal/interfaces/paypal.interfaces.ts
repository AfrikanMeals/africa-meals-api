import { AxiosInstance } from 'axios';

export interface IPaypalModuleOptions {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  axiosInstance: AxiosInstance;
}

export class IPaypalTokenResponse {
  scope: string;
  access_token: string;
  app_id: string;
  expires_in: number;
  nonce: string;
}
