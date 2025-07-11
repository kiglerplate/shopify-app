import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { auth, db } from "../firebaseClient";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { useLoaderData } from "@remix-run/react";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shopId: session.shop };
};

function normalizeId(raw: string): string {
  return (
    raw
      .toLowerCase()
      // כל רצף של תווים שאינם a–z או 0–9 יהפוך ל־'-'
      .replace(/[^a-z0-9]+/g, "-")
      // מסיר '-' מיותר בהתחלה ובסוף
      .replace(/^-+|-+$/g, "")
  );
}

const handleGoogleSignIn = async (shopId: string) => {
  try {
    const instanceId = normalizeId(shopId); // => "sisfore-myshopify-com"
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user!;
    if (!user.email) throw new Error("User email is null");

    // users collection – נשמור כרגיל תחת המייל שלו
    const userDocRef = doc(db, "users", user.email);
    const existing = await getDoc(userDocRef);

    if (!existing.exists()) {
      await setDoc(userDocRef, {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        platform: "shopify",
        instances: [instanceId],
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        isReady: false,
        requestNewQR: false,
      });
    } else {
      await updateDoc(userDocRef, {
        instances: arrayUnion(instanceId),
        displayName: user.displayName,
        photoURL: user.photoURL,
        lastLogin: new Date().toISOString(),
        isReady: false,
        requestNewQR: false,
      });
    }

    // whatsapp-settings collection – תוודא שמזהה המסמך הוא instanceId, לא shopId
    const whatsappSettingsRef = doc(db, "whatsapp-settings", instanceId);
    const whatsappSettingsSnap = await getDoc(whatsappSettingsRef);

    if (!whatsappSettingsSnap.exists()) {
      await setDoc(whatsappSettingsRef, {
        shopDomain: shopId, // אם חשוב לשמור גם את הדומיין המקורי
        userId: user.uid,
        email: user.email,
        phone: "",
        isActive: false,
        platform: "shopify",
        instances: [instanceId],
        createdAt: new Date().toISOString(),
      });
    } else {
      await updateDoc(whatsappSettingsRef, {
        instances: arrayUnion(instanceId),
      });
    }

    alert(`🎉 התחברת בהצלחה: ${user.displayName} לחנות ${instanceId}`);
  } catch (error) {
    console.error("❌ שגיאה בהתחברות:", error);
    alert("שגיאה בהתחברות עם Google");
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
        },
      },
    },
  );
  const responseJson = await response.json();

  const product = responseJson.data!.productCreate!.product!;
  const variantId = product.variants.edges[0]!.node!.id!;

  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyRemixTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    },
  );

  const variantResponseJson = await variantResponse.json();

  return {
    product: responseJson!.data!.productCreate!.product,
    variant:
      variantResponseJson!.data!.productVariantsBulkUpdate!.productVariants,
  };
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const { shopId } = useLoaderData<typeof loader>();

  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const productId = fetcher.data?.product?.id.replace(
    "gid://shopify/Product/",
    "",
  );

  useEffect(() => {
    if (productId) {
      shopify.toast.show("Product created");
    }
  }, [productId, shopify]);
  const generateProduct = () => fetcher.submit({}, { method: "POST" });

  return (
    <Page>
      {/* <TitleBar title="Remix app template">
        <button variant="primary" onClick={generateProduct}>
          Generate a product
        </button>
      </TitleBar> */}
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <Button
                  onClick={() => handleGoogleSignIn(shopId)}
                  variant="secondary"
                >
                  Sign in with Google11
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
