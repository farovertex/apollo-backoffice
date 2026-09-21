<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  layout: false,
  auth: false
})

useSeoMeta({
  title: 'Sign in',
  description: 'Sign in to the Apollo backoffice.'
})

// mirrors apollo-api auth.dto.ts usernameSchema (trim, lowercase, 3..32, ^[a-z0-9_.-]+$)
const schema = z.object({
  username: z.string()
    .trim()
    .toLowerCase()
    .min(1, 'Username is required')
    .min(3, 'Username must be 3–32 characters')
    .max(32, 'Username must be 3–32 characters')
    .regex(/^[a-z0-9_.-]+$/, 'Only a-z, 0-9, _ . - are allowed'),
  password: z.string()
    .min(1, 'Password is required')
    .max(128, 'Password is too long')
})

type Schema = z.output<typeof schema>

const state = reactive<Schema>({
  username: '',
  password: ''
})

const auth = useAuth()
const route = useRoute()

const loading = ref(false)
const error = ref<string | null>(null)
// SSR renders the button disabled until Vue has mounted: a click/Enter before hydration would otherwise trigger a
// native form submit (credentials in the URL). Implicit submission also respects a disabled default button.
const mounted = ref(false)

// BUG-002: the inputs stay interactive before hydration (fast typists, password managers autofilling on load), but
// hydration patches `<input :value>` back to the empty reactive state. Vue does that synchronously while hydrating the
// element, before any `onMounted`, so the DOM values are captured in `onBeforeMount` (DOM still untouched) and written
// into the state in `onMounted` (same task, no paint in between). Seeding the state *before* hydration would trigger a
// dev-only "Hydration attribute mismatch" warning instead.
let preHydrationValues: { username: string, password: string } | null = null
function readLoginInput(name: keyof Schema) {
  return document.querySelector<HTMLInputElement>(`[data-testid="login-form"] input[data-testid="login-${name}"]`)?.value ?? ''
}
onBeforeMount(() => {
  preHydrationValues = { username: readLoginInput('username'), password: readLoginInput('password') }
})
onMounted(() => {
  if (preHydrationValues) {
    if (preHydrationValues.username && !state.username) state.username = preHydrationValues.username
    if (preHydrationValues.password && !state.password) state.password = preHydrationValues.password
    preHydrationValues = null
  }
  mounted.value = true
})

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = null

  try {
    await auth.login(event.data.username, event.data.password)
    await navigateTo(safeRedirectPath(route.query.redirect) ?? '/', { replace: true })
  } catch (err) {
    const e = err as { statusCode?: number, data?: { error?: string } }
    if (e.statusCode === 401) {
      error.value = 'Invalid username or password'
    } else if (e.statusCode === 502 || e.statusCode === 503) {
      error.value = 'Cannot reach the API server. Please try again later.'
    } else {
      error.value = e.data?.error ? `Sign in failed: ${e.data.error}` : 'Sign in failed. Please try again.'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-elevated/25 p-4 sm:p-6">
    <UCard
      class="w-full max-w-sm"
      data-testid="login-card"
    >
      <template #header>
        <div class="flex flex-col gap-1">
          <h1 class="text-xl font-semibold text-highlighted">
            Sign in
          </h1>
          <p class="text-sm text-muted">
            Apollo backoffice
          </p>
        </div>
      </template>

      <UForm
        :schema="schema"
        :state="state"
        class="flex flex-col gap-4"
        data-testid="login-form"
        @submit="onSubmit"
      >
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
          role="alert"
          data-testid="login-error"
        />

        <UFormField
          label="Username"
          name="username"
          required
        >
          <UInput
            v-model="state.username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            class="w-full"
            data-testid="login-username"
          />
        </UFormField>

        <UFormField
          label="Password"
          name="password"
          required
        >
          <UInput
            v-model="state.password"
            type="password"
            autocomplete="current-password"
            class="w-full"
            data-testid="login-password"
          />
        </UFormField>

        <UButton
          type="submit"
          label="Sign in"
          block
          :loading="loading"
          :disabled="!mounted"
          data-testid="login-submit"
        />
      </UForm>
    </UCard>
  </div>
</template>
