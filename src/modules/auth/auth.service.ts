import { MailerService } from '@modules/mailer/mailer.service';
import { MediasService } from '@modules/medias/medias.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { PendingSignupModel } from '@schemas/pending-signup.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import {
  CheckAccountDto,
  EmailVerificationDto,
  ForgotPasswordDto,
  GoogleAuthDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  @InjectModel(UserModel.name)
  private readonly _usersModel: Model<UserModel>;

  @InjectModel(PendingSignupModel.name)
  private readonly _pendingSignupModel: Model<PendingSignupModel>;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  @Inject(JwtService)
  private readonly _jwtService: JwtService;

  @Inject(MailerService)
  private readonly _mailer: MailerService;

  @Inject(ConfigService)
  private readonly _configService: ConfigService;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  /**
   * Inscription en deux temps : aucune ligne dans `users` tant que le code e-mail
   * n’est pas validé (`register/complete`), sauf si SMTP désactivé / compte test.
   */
  async registerStart(args: RegisterDto) {
    const { source } = args;
    if (source !== 'email') {
      throw new BadRequestException('unsupported_registration_source');
    }

    const smtpUser = this._configService.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    const smtpConfigured = !!(smtpUser && smtpPass);
    const skipEmailVerification =
      this._configService.get<string>('SKIP_EMAIL_VERIFICATION') === 'true' ||
      !smtpConfigured;
    const isTestAccount =
      source === 'email' && args.email && args.email.includes('test');

    if (skipEmailVerification || isTestAccount) {
      const user = await this.registerCreateUserDirectly(args);
      const authToken = this._jwtService.sign({
        sub: user._id.toString(),
      });
      return {
        step: 'done' as const,
        authToken,
        user,
      };
    }

    const email = args.email.trim().toLowerCase();
    const existing = await this._usersModel
      .findOne({ email: this._emailMatchExact(email) })
      .exec();
    if (existing) {
      throw new ConflictException('user_email_conflict');
    }

    await this._pendingSignupModel.deleteMany({ email }).exec();

    const code = await this._generateVerificationCode(6);
    const passwordHash = await bcrypt.hash(args.password, 10);
    const userType = this._mapSignupRoleToUserType(args.signupRole);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this._pendingSignupModel.create({
      email,
      passwordHash,
      fullName: args.fullName.trim(),
      userType,
      verificationCode: code,
      expiresAt,
    });

    try {
      await this._sendSignupVerificationEmail(email, args.fullName.trim(), code);
    } catch (err: unknown) {
      await this._pendingSignupModel.deleteMany({ email }).exec();
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[register/start] échec envoi e-mail : ${msg}`);
      throw new ServiceUnavailableException('email_send_failed');
    }

    return {
      step: 'verify_email' as const,
      message:
        'Un code de vérification a été envoyé à votre adresse. Saisissez-le pour finaliser la création du compte.',
      email,
    };
  }

  /** Finalise l’inscription : crée l’utilisateur en base (e-mail déjà vérifié). */
  async registerComplete({ email: emailRaw, code }: EmailVerificationDto) {
    const email = emailRaw.trim().toLowerCase();
    const pending = await this._pendingSignupModel.findOne({ email }).exec();
    if (!pending) {
      throw new NotFoundException('invalid_or_expired_signup_code');
    }
    if (pending.expiresAt.getTime() < Date.now()) {
      await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
      throw new BadRequestException('signup_code_expired');
    }
    if (pending.verificationCode !== code.trim()) {
      throw new BadRequestException('invalid_or_expired_signup_code');
    }

    let newUser: UserModel;
    try {
      newUser = await this._usersModel.create({
        email: pending.email,
        password: pending.passwordHash,
        fullName: pending.fullName,
        type: pending.userType,
        emailVerifiedAt: new Date(),
      });
    } catch (err: unknown) {
      const mongo = err as { code?: number };
      if (mongo.code === 11000) {
        await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
        throw new ConflictException('user_email_conflict');
      }
      throw err;
    }

    await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
    const authToken = this._jwtService.sign({
      sub: newUser._id.toString(),
    });
    const user = await this.findUserById(newUser._id.toString());
    return { authToken, user };
  }

  async resendPendingSignupCode(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    const pending = await this._pendingSignupModel.findOne({ email }).exec();
    if (!pending) {
      throw new NotFoundException('pending_signup_not_found');
    }
    if (pending.expiresAt.getTime() < Date.now()) {
      await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
      throw new BadRequestException('signup_code_expired');
    }
    const code = await this._generateVerificationCode(6);
    pending.verificationCode = code;
    pending.expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await pending.save();
    await this._sendSignupVerificationEmail(email, pending.fullName, code);
    return {
      ok: true as const,
      message: 'Un nouveau code a été envoyé.',
    };
  }

  private async _sendSignupVerificationEmail(
    toEmail: string,
    fullName: string,
    code: string,
  ) {
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'African Meals';
    const subject = `Vérifiez votre courriel - ${appName}`;
    const html = `
      <h2>Finalisez votre inscription</h2>
      <p>Bonjour ${fullName},</p>
      <p>Votre code de vérification : <strong>${code}</strong></p>
      <p>Il est valable 30 minutes. Après validation, votre compte sera créé.</p>
      <p>Si vous n’avez pas demandé d’inscription, ignorez ce message.</p>
      <p>— L’équipe ${appName}</p>
    `.trim();
    const text = `Code d’inscription ${appName} : ${code} (30 min).`;
    await this._mailer.sendSimple({
      to: toEmail,
      toName: fullName,
      subject,
      html,
      text,
    });
  }

  /** Ancienne inscription : utilisateur créé tout de suite (avec ou sans code d’activation). */
  async register(args: RegisterDto) {
    return this.registerCreateUserDirectly(args);
  }

  private async registerCreateUserDirectly(args: RegisterDto) {
    const { source, signupRole, ...rest } = args;
    const userType = this._mapSignupRoleToUserType(signupRole);
    this.logger.log(
      `[register] demande source=${source} email=${args.email ?? '—'} fullName=${args.fullName ?? '—'} signupRole=${signupRole ?? '—'} type=${userType}`,
    );

    const user = await this._usersModel.findOne({
      [source]: args[source],
    });
    if (user) {
      this.logger.warn(
        `[register] conflit user_${source}_conflict pour ${args.email ?? args[source]}`,
      );
      throw new ConflictException(`user_${source}_conflict`);
    }

    const smtpUser = this._configService.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    const smtpConfigured = !!(smtpUser && smtpPass);
    const skipEmailVerification =
      this._configService.get<string>('SKIP_EMAIL_VERIFICATION') === 'true' ||
      !smtpConfigured;

    const isTestAccount =
      source === 'email' && rest.email && rest.email.includes('test');

    /** Compte vérifié tout de suite : pas d’SMTP / pas d’email à envoyer */
    const verifyImmediately =
      skipEmailVerification || isTestAccount;

    const activationCode = verifyImmediately
      ? undefined
      : await this._generateVerificationCode(6);

    this.logger.log(
      `[register] options skipEmailVerification=${skipEmailVerification} isTestAccount=${isTestAccount} verifyImmediately=${verifyImmediately} smtpConfigured=${smtpConfigured}`,
    );

    const dbName = this._usersModel.db?.name ?? '?';
    const collectionName =
      this._usersModel.collection?.collectionName ?? 'users';
    this.logger.log(
      `[register] cible MongoDB db="${dbName}" collection="${collectionName}"`,
    );

    const documentToInsert = {
      ...rest,
      type: userType,
      ...(verifyImmediately
        ? { emailVerifiedAt: new Date() }
        : { activationCode }),
    };
    this.logger.log(
      `[register] payload insert (mdp masqué) ${JSON.stringify({
        ...documentToInsert,
        password: '***',
      })}`,
    );

    let newUser: UserModel;
    try {
      newUser = await this._usersModel.create(documentToInsert);
    } catch (err: unknown) {
      const mongo = err as {
        code?: number;
        keyPattern?: Record<string, unknown>;
        keyValue?: Record<string, unknown>;
        message?: string;
      };
      this.logger.error(
        `[register] échec Mongoose create code=${mongo.code ?? 'n/a'} keyPattern=${JSON.stringify(mongo.keyPattern)} keyValue=${JSON.stringify(mongo.keyValue)} message=${mongo.message ?? err}`,
        err instanceof Error ? err.stack : undefined,
      );
      if (mongo.code === 11000) {
        throw new ConflictException(
          `user_${source}_conflict`,
        );
      }
      throw err;
    }

    this.logger.log(
      `[register] utilisateur créé id=${newUser._id.toString()} email=${newUser.email} type=${newUser.type} emailVerifiedAt=${verifyImmediately ? newUser.emailVerifiedAt?.toISOString?.() ?? 'oui' : 'non'}`,
    );

    if (!verifyImmediately && activationCode) {
      try {
        const appName =
          this._configService.get<string>('APP_NAME') ?? 'African Meals';
        await this._mailer.send({
          to: args.email,
          subject: `Bienvenue sur ${appName}`,
          context: {
            name: args.fullName,
            code: activationCode,
          },
        });
        this.logger.log(
          `[register] email de vérification envoyé vers ${args.email}`,
        );
      } catch (err: unknown) {
        const detail =
          err && typeof err === 'object' && 'body' in err
            ? JSON.stringify((err as { body?: unknown }).body)
            : err instanceof Error
              ? err.message
              : String(err);
        this.logger.warn(
          `Échec envoi email d'inscription (SMTP) : ${detail}`,
        );
        // En local, clé invalide / 401 « Unauthenticated » : on valide quand même le compte pour pouvoir se connecter
        if (process.env.NODE_ENV !== 'production') {
          await this._usersModel.findByIdAndUpdate(newUser._id, {
            $set: { emailVerifiedAt: new Date() },
            $unset: { activationCode: '' },
          });
          this.logger.log(
            `[register] compte auto-vérifié (non-production) id=${newUser._id.toString()}`,
          );
        }
      }
    }

    this.logger.log(`[register] terminé id=${newUser._id.toString()}`);
    return this.findUserById(newUser._id.toString());
  }

  /** Connexion / inscription avec Google : trouve ou crée l'utilisateur, retourne le JWT */
  async authWithGoogle(args: GoogleAuthDto) {
    let user = await this._usersModel
      .findOne({ googleId: args.googleId })
      .exec();
    if (user) {
      return {
        authToken: this._jwtService.sign({ sub: user._id.toString() }),
      };
    }
    user = await this._usersModel.findOne({ email: args.email }).exec();
    if (user) {
      await this._usersModel
        .updateOne(
          { _id: user._id },
          { googleId: args.googleId, emailVerifiedAt: new Date() },
        )
        .exec();
      return {
        authToken: this._jwtService.sign({ sub: user._id.toString() }),
      };
    }
    const newUser = await this._usersModel.create({
      email: args.email,
      fullName: args.fullName,
      googleId: args.googleId,
      password: `google_${args.googleId}_${Date.now()}`,
      emailVerifiedAt: new Date(),
    });
    return {
      authToken: this._jwtService.sign({ sub: newUser._id.toString() }),
    };
  }

  async login(args: LoginDto) {
    const { source, ...rest } = args;
    const user = await this._usersModel
      .findOne({
        [source]: args[source],
      })
      .select(['+password', '+emailVerifiedAt'])
      .exec();

    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }

    if (!(await bcrypt.compare(rest.password, user.password))) {
      throw new NotFoundException(`user_not_found`);
    }

    // TODO adjust verification based on source. For now, we only verify email

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(`email_not_verified`);
    }

    // TODO add user role(admin, user, etc) claims
    return {
      authToken: this._jwtService.sign({ sub: user._id.toString() }),
    };
  }

  async checkAccount(args: CheckAccountDto) {
    const user = await this._usersModel
      .findOne({ [args.source]: args[args.source] })
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    return user;
  }

  async verifyEmail({ code: activationCode, email }: EmailVerificationDto) {
    const user = await this._usersModel
      .findOneAndUpdate(
        { activationCode, email, emailVerifiedAt: null },
        { activationCode: null, emailVerifiedAt: new Date() },
        { new: true },
      )
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    return user;
  }

  async resendVerificationCode(email: string) {
    const code = await this._generateVerificationCode(6);
    const user = await this._usersModel
      .findOneAndUpdate(
        { email },
        {
          emailVerifiedAt: null,
          activationCode: code,
        },
        { new: true },
      )
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'African Meals';
    await this._mailer.send({
      to: email,
      subject: `Bienvenue sur ${appName}`,
      context: {
        name: user.fullName,
        code,
      },
    });
    return user;
  }

  /**
   * Demande de réinitialisation : enregistre un code et envoie l’e-mail via SMTP.
   * Réponse identique si l’email est inconnu (pas d’énumération de comptes).
   */
  async forgotPassword({ email: emailRaw }: ForgotPasswordDto) {
    const email = emailRaw.trim().toLowerCase();
    const generic = {
      ok: true as const,
      message:
        'Si un compte existe pour cette adresse, un code vous a été envoyé par e-mail.',
    };

    const user = await this._usersModel
      .findOne({ email: this._emailMatchExact(email) })
      .exec();
    if (!user) {
      this.logger.log(`[forgot-password] aucun utilisateur pour ${email}`);
      return generic;
    }

    const code = await this._generateVerificationCode(6);
    await this._usersModel
      .findOneAndUpdate(
        { _id: user._id },
        { $set: { passwordResetCode: code } },
        { new: true },
      )
      .exec();

    const appName =
      this._configService.get<string>('APP_NAME') ?? 'African Meals';
    const subject = `Réinitialisation de mot de passe - ${appName}`;
    const html = `
      <h2>Réinitialisation de mot de passe</h2>
      <p>Bonjour ${user.fullName},</p>
      <p>Voici votre code de réinitialisation : <strong>${code}</strong></p>
      <p>Ce code est valide 15 minutes. Ne le partagez avec personne.</p>
      <p>Si vous n'avez pas demandé ce code, ignorez cet email.</p>
      <p>— L'équipe ${appName}</p>
    `.trim();
    const text = `Code de réinitialisation : ${code}. Valide 15 min. - ${appName}`;

    const smtpUser = this._configService.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    if (!smtpUser || !smtpPass) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `[forgot-password] SMTP non configuré — code pour ${email} : ${code}`,
        );
      } else {
        this.logger.warn(
          `[forgot-password] SMTP non configuré pour ${email}`,
        );
      }
      return generic;
    }

    try {
      await this._mailer.sendSimple({
        to: user.email,
        toName: user.fullName,
        subject,
        html,
        text,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[forgot-password] échec SMTP : ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ServiceUnavailableException('email_send_failed');
    }

    return generic;
  }

  async resetPassword({ email: emailRaw, code, password }: ResetPasswordDto) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this._usersModel
      .findOne({ email: this._emailMatchExact(email) })
      .select('+passwordResetCode')
      .exec();

    if (!user?.passwordResetCode || user.passwordResetCode !== code.trim()) {
      throw new BadRequestException('invalid_reset_code');
    }

    user.password = password;
    user.set('passwordResetCode', undefined);
    await user.save();

    return { ok: true as const, message: 'Mot de passe mis à jour.' };
  }

  async findUserById(id: string) {
    return this._usersModel
      .findOne({ _id: id })
      .populate('addresses')
      .populate('stores')
      .populate('paymentMethods')
      .exec();
  }

  /** Score fidélité + historique (plus récent en premier). */
  async getMyRewards(userId: string) {
    const u = await this._usersModel
      .findById(userId)
      .select('loyaltyPoints rewardHistory')
      .lean()
      .exec();
    if (!u) throw new NotFoundException('user_not_found');
    const doc = u as Record<string, unknown>;
    const raw = (doc.rewardHistory as Record<string, unknown>[]) ?? [];
    const history = [...raw].sort(
      (a, b) =>
        new Date(String(b.createdAt)).getTime() -
        new Date(String(a.createdAt)).getTime(),
    );
    return {
      score: Number(doc.loyaltyPoints ?? 0),
      history: history.map((h) => ({
        points: Number(h.points),
        reason: String(h.reason ?? ''),
        createdAt: h.createdAt,
      })),
    };
  }

  async updateProfile(userId: string, args: UpdateProfileDto) {
    const update: Partial<UserModel> = {};
    if (args.fullName != null) update.fullName = args.fullName;
    if (args.phoneNumber != null) update.phoneNumber = args.phoneNumber;
    if (args.appCountryCode != null) {
      const c = args.appCountryCode.trim().toUpperCase();
      if (!(await this._supportedCountries.isActiveCode(c))) {
        throw new BadRequestException('Ce pays n’est pas disponible.');
      }
      update.appCountryCode = c;
    }
    if (Object.keys(update).length === 0) {
      return this.findUserById(userId);
    }
    const user = await this._usersModel
      .findOneAndUpdate({ _id: userId }, update, { new: true })
      .populate('addresses')
      .populate('stores')
      .populate('paymentMethods')
      .exec();
    if (!user) throw new NotFoundException('user_not_found');
    return user;
  }

  async updateProfileImage(
    userId: string,
    file: Express.Multer.File,
    user: UserModel,
  ) {
    let url: string | undefined;
    try {
      const existing = await this._usersModel
        .findOne({ _id: userId })
        .exec();
      if (!existing) throw new NotFoundException('user_not_found');
      if (user._id.toString() !== userId) {
        throw new ForbiddenException('forbidden');
      }
      url = await this._mediasService.upload(
        file,
        user,
        `users/${userId}/profile`,
      );
      if (!url) throw new BadRequestException('image_upload_failed');
      if (existing.profileImage) {
        try {
          await this._mediasService.delete(existing.profileImage);
        } catch (_) {
          // ignore delete errors (e.g. invalid path)
        }
      }
      await this._usersModel
        .updateOne({ _id: userId }, { profileImage: url })
        .exec();
      return this.findUserById(userId);
    } catch (e) {
      if (url) {
        try {
          await this._mediasService.delete(url);
        } catch (_) {}
      }
      throw e;
    }
  }

  /** Supprime la photo de profil (met profileImage à null et supprime le fichier sur Storage si possible). */
  async removeProfileImage(userId: string, user: UserModel) {
    if (user._id.toString() !== userId) {
      throw new ForbiddenException('forbidden');
    }
    const existing = await this._usersModel.findOne({ _id: userId }).exec();
    if (!existing) throw new NotFoundException('user_not_found');
    if (existing.profileImage) {
      try {
        await this._mediasService.delete(existing.profileImage);
      } catch (_) {
        // ignore delete errors
      }
    }
    await this._usersModel
      .updateOne(
        { _id: userId },
        { $unset: { profile_image: 1 } },
      )
      .exec();
    return this.findUserById(userId);
  }

  async findUserByEmail(email: string) {
    return this._usersModel.findOne({ email }).exec();
  }

  /** Supprime le compte utilisateur (irréversible). */
  async deleteAccount(userId: string) {
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    await this._usersModel.deleteOne({ _id: userId }).exec();
    return { message: 'account_deleted' };
  }

  /** Rôles du formulaire d’inscription Dashboard → `UserModel.type` */
  private _mapSignupRoleToUserType(
    role?: RegisterDto['signupRole'],
  ): UserTypeEnum {
    switch (role) {
      case 'restaurant':
        return UserTypeEnum.VENDOR;
      case 'livreur':
        return UserTypeEnum.DELIVERY;
      case 'client':
      default:
        return UserTypeEnum.USER;
    }
  }

  private _emailMatchExact(email: string) {
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}$`, 'i');
  }

  private async _generateVerificationCode(length: number) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }
}
