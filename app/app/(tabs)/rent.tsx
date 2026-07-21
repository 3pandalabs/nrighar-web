import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Alert, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { ScreenBackground } from "../../components/ScreenBackground";
import { useAuth } from "../../hooks/useAuth";
import { api, ApiError } from "../../lib/api";
import { SITE_URL } from "../../lib/constants";
import {
  formatInr,
  type Lease,
  type PayLink,
  type Property,
  type RentPayment,
  type Tenant,
} from "../../lib/types";

export default function RentScreen() {
  const { user } = useAuth();
  const [leases, setLeases] = useState<Lease[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [payments, setPayments] = useState<RentPayment[]>([]);
  const [payLinks, setPayLinks] = useState<PayLink[]>([]);
  const [upiVpa, setUpiVpa] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sendingLease, setSendingLease] = useState<string | null>(null);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  const load = useCallback(async () => {
    const [leaseRows, props, tenantRows, paymentRows, payLinkRows, profile] = await Promise.all([
      api.get<Lease[]>("/leases"),
      api.get<Property[]>("/properties"),
      api.get<Tenant[]>("/tenants"),
      api.get<RentPayment[]>("/rent-payments"),
      api.get<PayLink[]>("/pay-links"),
      user
        ? api.get<{ upiVpa: string | null }>("/profile")
        : Promise.resolve({ upiVpa: null }),
    ]);

    setLeases(leaseRows.filter((l) => l.status === "active"));
    setProperties(props);
    setTenants(tenantRows);
    setPayments(paymentRows.filter((p) => p.periodYear === year && p.periodMonth === month));
    setPayLinks(payLinkRows.filter((p) => p.periodYear === year && p.periodMonth === month));
    setUpiVpa(profile.upiVpa ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  async function sendPayLink(lease: Lease, tenant: Tenant, property: Property | undefined) {
    if (!user || !tenant.phone) return;
    setSendingLease(lease.id);
    try {
      let payLinkUrl: string | null = null;
      if (upiVpa) {
        try {
          const payLink = await api.post<PayLink>(`/leases/${lease.id}/pay-links`, {
            periodYear: year,
            periodMonth: month,
            amountDue: Number(lease.rentAmount),
          });
          payLinkUrl = `${SITE_URL}/pay/${payLink.id}`;
        } catch (err) {
          Alert.alert(
            "Could not create pay link",
            err instanceof ApiError ? err.code.replace(/_/g, " ") : "Something went wrong."
          );
          return;
        }
      }

      const rupees = formatInr(Number(lease.rentAmount));
      const propertyName = property?.nickname ?? "the property";
      const message = payLinkUrl
        ? `Hi ${tenant.fullName}, hope you're doing well! A gentle reminder that the rent of ${rupees} for ${propertyName} for ${monthLabel} is due. You can pay via UPI here: ${payLinkUrl} — it opens your UPI app with my details filled in. Thank you!`
        : `Hi ${tenant.fullName}, hope you're doing well! A gentle reminder that the rent of ${rupees} for ${propertyName} for ${monthLabel} is due. Please let me know once it's transferred. Thank you!`;

      const digits = tenant.phone.replace(/\D/g, "");
      const withCountry = digits.length === 10 ? `91${digits}` : digits;
      await Linking.openURL(`https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`);
      await load();
    } finally {
      setSendingLease(null);
    }
  }

  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  const paymentByLease = new Map(payments.map((p) => [p.leaseId, p]));
  const payLinkByLease = new Map(payLinks.map((p) => [p.leaseId, p]));

  return (
    <ScreenBackground>
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={leases}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      ListHeaderComponent={
        <View>
          <Text style={styles.month}>{monthLabel}</Text>
          {!upiVpa && (
            <Text style={styles.hint}>
              Add your UPI ID in Settings on the website and reminders will carry a pay link.
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>No active leases — set them up on the web dashboard.</Text>
      }
      renderItem={({ item }) => {
        const property = propertyById.get(item.propertyId);
        const tenant = tenantById.get(item.tenantId);
        const payment = paymentByLease.get(item.id);
        const payLink = payLinkByLease.get(item.id);
        const overdue = !payment && now.getDate() > item.rentDueDay;
        const statusLabel =
          payment?.status === "paid"
            ? "Paid"
            : payment?.status === "partial"
              ? `Partial: ${formatInr(Number(payment.amountPaid ?? 0))}`
              : overdue
                ? "Overdue"
                : `Due (day ${item.rentDueDay})`;

        return (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.nickname}>{property?.nickname ?? "Property"}</Text>
              <Text
                style={[
                  styles.status,
                  payment?.status === "paid"
                    ? styles.statusPaid
                    : overdue
                      ? styles.statusOverdue
                      : styles.statusDue,
                ]}
              >
                {statusLabel}
              </Text>
            </View>
            <Text style={styles.detail}>
              {tenant?.fullName ?? "Tenant"} · {formatInr(Number(item.rentAmount))}/month
            </Text>
            {payment?.status !== "paid" && payLink && (
              <Text style={styles.payLinkStatus}>
                Pay link sent
                {payLink.openedAt ? " · opened ✓" : ""}
                {payLink.claimedPaidAt ? " · tenant says paid ✓ (confirm on web)" : ""}
              </Text>
            )}
            {payment?.status !== "paid" && tenant?.phone && (
              <Pressable
                style={styles.reminderButton}
                disabled={sendingLease === item.id}
                onPress={() => sendPayLink(item, tenant, property)}
              >
                <Text style={styles.reminderText}>
                  {sendingLease === item.id
                    ? "..."
                    : upiVpa
                      ? "WhatsApp pay link"
                      : "WhatsApp reminder"}
                </Text>
              </Pressable>
            )}
          </View>
        );
      }}
    />
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
    gap: 12,
  },
  month: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: "#b45309",
    marginBottom: 8,
  },
  empty: {
    textAlign: "center",
    color: "#666",
    marginTop: 40,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  nickname: {
    fontSize: 16,
    fontWeight: "600",
  },
  status: {
    fontSize: 13,
    fontWeight: "600",
  },
  statusPaid: {
    color: "#059669",
  },
  statusDue: {
    color: "#b45309",
  },
  statusOverdue: {
    color: "#dc2626",
  },
  detail: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  payLinkStatus: {
    fontSize: 13,
    color: "#059669",
    marginTop: 6,
  },
  reminderButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#059669",
    borderRadius: 999,
    paddingVertical: 8,
    alignItems: "center",
  },
  reminderText: {
    color: "#059669",
    fontSize: 14,
    fontWeight: "600",
  },
});
