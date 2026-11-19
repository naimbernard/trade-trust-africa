/**
 * Billing provider boundary. Only a simulated provider exists: it records plan changes without taking payment.
 * A real provider (e.g. Stripe, Paystack, Flutterwave) must be added behind this same interface after
 * contracting, PCI scoping and legal review. Card details must never touch this server: use hosted checkout.
 */
export function billingProvider(config) {
  if (config.billingProvider === 'simulated') {
    return {
      name: 'simulated',
      live: false,
      async changePlan({ orgId, planCode }) {
        return { providerRef: `sim_${planCode}_${orgId.slice(0, 8)}_${Date.now()}`, status: planCode === 'enterprise' ? 'pending_quote' : 'active', checkoutUrl: null };
      },
    };
  }
  throw new Error(`Billing provider "${config.billingProvider}" is not implemented`);
}
