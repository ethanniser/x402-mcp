import type { EvmNetwork, SvmNetwork } from "./types.js";

export interface PreSignAuthorizationRequest {
	x402Version: number;
	paymentRequirements: {
		scheme: "exact";
		network: EvmNetwork | SvmNetwork;
		maxAmountRequired: string;
		resource: string;
		description: string;
		mimeType: string;
		outputSchema?: Record<string, unknown>;
		payTo: string;
		maxTimeoutSeconds: number;
		asset: string;
		extra?: unknown;
	};
	signal: AbortSignal;
}

export interface PreSignAuthorizationDecision {
	decision: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL";
	reason?: string;
	receiptId?: string;
}

export interface PreSignAuthorizationOptions {
	check: (
		request: PreSignAuthorizationRequest,
	) => Promise<PreSignAuthorizationDecision>;
	timeoutMs?: number;
}

export async function authorizeBeforeSigning(
	authorization: PreSignAuthorizationOptions | undefined,
	x402Version: number,
	paymentRequirements: PreSignAuthorizationRequest["paymentRequirements"],
): Promise<void> {
	if (!authorization) return;

	const timeoutMs = authorization.timeoutMs ?? 3_000;
	if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
		throw new Error("Pre-sign authorization timeout must be a positive integer");
	}

	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;

	try {
		const decision = await Promise.race([
			authorization.check({
				x402Version,
				paymentRequirements,
				signal: controller.signal,
			}),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => {
					controller.abort();
					reject(new Error("Pre-sign authorization timed out"));
				}, timeoutMs);
			}),
		]);

		if (
			!decision ||
			typeof decision !== "object" ||
			!["ALLOW", "BLOCK", "REQUIRE_APPROVAL"].includes(decision.decision)
		) {
			throw new Error("Pre-sign authorization returned an invalid decision");
		}

		if (decision.decision !== "ALLOW") {
			const reason = decision.reason ? `: ${decision.reason}` : "";
			throw new Error(`Pre-sign authorization ${decision.decision}${reason}`);
		}
	} catch (error) {
		throw new Error("Payment was not signed because pre-sign authorization failed", {
			cause: error,
		});
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
