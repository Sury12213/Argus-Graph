// ============================================
// Shared API Response DTOs
// ============================================

export class ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp: string;

  constructor(data: T, message?: string) {
    this.success = true;
    this.data = data;
    this.message = message;
    this.timestamp = new Date().toISOString();
  }
}

export class ApiError {
  success: false;
  error: string;
  statusCode: number;
  timestamp: string;

  constructor(error: string, statusCode: number) {
    this.success = false;
    this.error = error;
    this.statusCode = statusCode;
    this.timestamp = new Date().toISOString();
  }
}
