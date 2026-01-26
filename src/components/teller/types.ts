// Shared Teller Connect types

export interface TellerConnectEnrollment {
  id: string;
  institution: {
    id?: string;
    name: string;
  };
}

export interface TellerConnectAccount {
  id: string;
}

export interface TellerConnectSuccessPayload {
  accessToken: string;
  enrollment: TellerConnectEnrollment;
  accounts?: TellerConnectAccount[];
}

export interface TellerConnectOptions {
  applicationId: string;
  environment?: 'sandbox' | 'development' | 'production';
  products?: string[];
  onSuccess: (payload: TellerConnectSuccessPayload) => void;
  onExit?: () => void;
  onFailure?: (error: { message: string }) => void;
  // Extended options (may not be fully typed by Teller)
  [key: string]: unknown;
}

export interface TellerConnect {
  open: () => void;
}

declare global {
  interface Window {
    TellerConnect?: {
      setup: (options: TellerConnectOptions) => TellerConnect;
    };
  }
}
