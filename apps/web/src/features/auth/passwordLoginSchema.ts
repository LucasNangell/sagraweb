import { z } from "zod";

export const passwordLoginSchema = z.object({
  login: z
    .string()
    .min(1, "Informe o e-mail ou o ponto (somente números)")
    .refine(
      (value) => {
        const trimmed = value.trim();
        if (trimmed.includes("@")) {
          return z.string().email().safeParse(trimmed).success;
        }
        return /^\d+$/.test(trimmed.replace(/\D/g, "")) && trimmed.replace(/\D/g, "").length > 0;
      },
      { message: "Informe um e-mail válido ou ponto (apenas números)" },
    ),
  password: z.string().min(1, "Informe a senha"),
});

export type PasswordLoginFormValues = z.infer<typeof passwordLoginSchema>;

export const activateSchema = z
  .object({
    password: z.string().min(8, "A senha deve ter no mínimo 8 caracteres"),
    confirmPassword: z.string().min(1, "Confirme a senha"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export type ActivateFormValues = z.infer<typeof activateSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().min(1, "Informe o e-mail").email("Informe um e-mail válido"),
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
