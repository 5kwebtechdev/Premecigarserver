// The order number customers and admins see: "PM" + the order id padded to 4 digits (PM0010, PM0123, PM12345).
// It is just a readable form of the real id, so links and lookups keep using the plain number.
export const orderCode = (id) => `PM${String(id).padStart(4, '0')}`;
