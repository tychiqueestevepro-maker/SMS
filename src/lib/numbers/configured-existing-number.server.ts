import "server-only";

export const CONFIGURED_EXISTING_NUMBER = Object.freeze({
  addressSid: "ADd9447bc87874941ef20cef80c3872546",
  bundleSid: "BU261723150ab7ceaaf04d95802faf3380",
  ownerEmail: "tychiqueesteve2005@gmail.com",
  ownerUserId: "813e98ef-74da-4752-a228-3a018e56d777",
  phoneNumber: "+33939245110",
  providerNumberId: "PNe5c6311d0e30ca70e0c49e923757e8e9",
});

export function canConnectConfiguredExistingNumber(input: {
  email: string | null;
  userId: string;
}): boolean {
  return (
    input.userId === CONFIGURED_EXISTING_NUMBER.ownerUserId &&
    input.email?.trim().toLowerCase() === CONFIGURED_EXISTING_NUMBER.ownerEmail
  );
}
