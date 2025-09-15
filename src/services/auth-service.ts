import { API_BASE_URL } from "./constants";
import { ElectronService } from "./electron-service";

export class AuthService {
  private static instance: AuthService;
  private apiKey: string | null = null;
  private hasConsented: boolean = false;
  private userId: string | null = null;

  private constructor() {
    // Try to load stored API key
    this.loadApiKey();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Load API key from storage
   */
  private async loadApiKey(): Promise<void> {
    try {
      const result = await ElectronService.loadCredentials();
      if (result.success && result.data.apiKey) {
        this.apiKey = result.data.apiKey;
        // Convert stored consent value to a strict boolean
        const consentVal = result.data.hasConsented;
        this.hasConsented = consentVal === true || consentVal === "true";
      }
    } catch (error) {
      console.error("Error loading API key:", error);
    }
  }

  /**
   * Check if user is authenticated and has consented
   */
  public isAuthenticated(): boolean {
    // Check if we're in direct settings mode (from Electron)
    if (
      (window as any).SKIP_AUTH === true ||
      (window as any).DIRECT_SETTINGS === true
    ) {
      return true;
    }
    return !!this.apiKey && this.hasConsented;
  }

  /**
   * Check if user has just an API key but hasn't consented
   */
  public hasApiKey(): boolean {
    return !!this.apiKey;
  }

  /**
   * Get the user's info, validating the API key in the process
   */
  public async validateApiKey(
    apiKey: string,
  ): Promise<
    { success: true; userId: string } | { success: false; message?: string }
  > {
    try {
      if (!apiKey || apiKey.trim() === "") {
        return { success: false, message: "API key cannot be empty" };
      }

      // Simple validation - check if it starts with 'sk_'
      if (!apiKey.startsWith("sk_")) {
        return { success: false, message: "Invalid API key format" };
      }

      const rawResponse = await fetch(`${API_BASE_URL}/api/v1/user/info`, {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
      });
      if (!rawResponse.ok) {
        return {
          success: false,
          message:
            "Invalid API key, or server unavailable: " + rawResponse.statusText,
        };
      }

      const response: { userId: string } = await rawResponse.json();

      // Store the API key
      this.apiKey = apiKey;
      this.userId = response.userId;

      // Save to secure storage
      await ElectronService.saveCredentials("apiKey", apiKey);

      return { success: true, userId: response.userId };
    } catch (error) {
      console.error("API key validation error:", error);
      return { success: false, message: "API key validation failed" };
    }
  }

  /**
   * Set consent status
   */
  public async setConsent(hasConsented: boolean): Promise<void> {
    this.hasConsented = hasConsented;

    // Save to secure storage
    await ElectronService.saveCredentials(
      "hasConsented",
      hasConsented ? "true" : "false",
    );
  }

  /**
   * Get user information
   */
  public async getUserInfo(): Promise<
    | {
        authenticated: true;
        hasApiKey: boolean;
        hasConsented: boolean;
        method: string;
        apiKey: string;
        userId: string;
      }
    | { authenticated: false }
  > {
    if (!this.apiKey) {
      return { authenticated: false };
    }

    // Apologies for the very messy control flow here; I'm trying to make
    // the fewest changes possible to get this working, as this will all
    // hopefully be replaced in the future.
    let userId = this.userId;
    if (!userId) {
      const validationResult = await this.validateApiKey(this.apiKey);
      if (validationResult.success) {
        userId = validationResult.userId;
      } else {
        throw new Error("Failed to validate API key");
      }
    }

    // Return user info
    return {
      authenticated: this.isAuthenticated(),
      hasApiKey: this.hasApiKey(),
      hasConsented: this.hasConsented,
      method: "apiKey",
      apiKey: this.apiKey && this.apiKey.substring(0, 10) + "...",
      userId: userId,
    };
  }

  /**
   * Logout user
   */
  public async logout(): Promise<void> {
    this.apiKey = null;
    this.hasConsented = false;
    this.userId = null;

    // Remove from secure storage
    await ElectronService.saveCredentials("apiKey", "");
    await ElectronService.saveCredentials("hasConsented", "false");
  }
}
