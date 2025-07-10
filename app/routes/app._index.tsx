import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { auth, db } from "../firebaseClient";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { useLoaderData } from "@remix-run/react";
import { doc, getDoc, setDoc } from "firebase/firestore";


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

const handleGoogleSignIn = async (shopId: string) => {
    try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    const userDocRef = doc(db, "users", user.email);
    const existing = await getDoc(userDocRef);

    const instanceId = shopId;


    if (!existing.exists()) {
      await setDoc(userDocRef, {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        platform: "shopify",
        instances: [instanceId],
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      });
    } else {
      const userData = existing.data();
      await setDoc(userDocRef, {
        ...userData,
        shopId: shopId,
         instances: arrayUnion(instanceId),
        lastLogin: new Date().toISOString(),
        displayName: user.displayName,
        photoURL: user.photoURL
      });
    }

    const whatsappSettingsRef = doc(db, "whatsapp-settings", shopId);
    const whatsappSettingsSnap = await getDoc(whatsappSettingsRef);

    if (!whatsappSettingsSnap.exists()) {
      await setDoc(whatsappSettingsRef, {
        shopId: shopId,
        userId: user.uid,
        email: user.email,
        phone: "",
        isActive: false,
        platform: "shopify",
        instances: arrayUnion(instanceId),
        createdAt: new Date().toISOString(),
      });
    }

    alert(`🎉 התחברת בהצלחה: ${user.displayName} לחנות ${shopId}`);
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
      <TitleBar title="Remix app template">
        <button variant="primary" onClick={generateProduct}>
          Generate a product
        </button>
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
<Button onClick={() => handleGoogleSignIn(shopId)} variant="secondary">
  Sign in with Google
</Button>

              </BlockStack>
            </Card>
          </Layout.Section>
     
        </Layout>
      </BlockStack>
    </Page>
  );
}
function arrayUnion(instanceId: string) {
  throw new Error("Function not implemented.");
}

