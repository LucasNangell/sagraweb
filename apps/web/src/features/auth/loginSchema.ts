import { z } from "zod";

export const loginSchema = z.object({
  ponto: z
    .string()
    .min(1, "Informe o ponto (somente números)")
    .regex(/^\d+$/, "O ponto deve conter apenas números, sem letras ou símbolos"),
  nome: z.string().min(2, "Informe seu nome completo"),
  password: z.string().optional(),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
